/**
 * TextCanvas —— 把 DOM 诗句离屏渲染成 CanvasTexture。
 *
 * 对应原站的 AK 类（挂在 .xp-text-w-inside 上）：
 * HTML 中保留两份诗句 DOM，一份负责语义/测量，另一份被绘制成
 * 画布纹理供 WebGL 文字四边形采样，同时保留像素数据用于命中检测
 * （鼠标是否悬停在文字笔画上 → 可点击进入诗歌视图）。
 *
 * 画布布局（横向三瓦片）：
 *   [ 清晰 ] [ 低模糊 ] [ 高模糊 ]
 * 每个瓦片包含完整的 3 节诗句竖向堆叠。
 */
import * as THREE from "three";

const TILE_PADDING = 24;

export class TextCanvas {
  texture: THREE.CanvasTexture | null = null;

  /** 内容尺寸（CSS px） */
  contentWidth = 0;
  contentHeight = 0;
  /** 单瓦片宽度（CSS px） */
  tileWidth = 0;

  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _imageData: ImageData | null = null;
  private _dpr = 2;
  private _mobile = false;
  /** 每节诗句在内容中的纵向区间（0~1，相对内容总高） */
  sectionRanges: { min: number; max: number }[] = [];

  /** 等字体就绪后绘制 */
  async prepare(): Promise<void> {
    const fontSize = window.innerWidth < 768 ? 25 : 30;
    await document.fonts.load(`100 ${fontSize}px "Canela Text"`);
    await document.fonts.ready;
    this._render();
  }

  private _extractSections(): string[][] {
    const sections: string[][] = [];
    const readLines = (root: Node): string[] => {
      const lines: string[] = [""];
      const visit = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          lines[lines.length - 1] += node.textContent ?? "";
          return;
        }
        if (!(node instanceof HTMLElement)) return;
        if (node.tagName === "BR") {
          lines.push("");
          return;
        }
        const block = /^(DIV|P)$/.test(node.tagName);
        if (block && lines[lines.length - 1].trim()) lines.push("");
        node.childNodes.forEach(visit);
        if (block && lines[lines.length - 1].trim()) lines.push("");
      };
      root.childNodes.forEach(visit);
      return lines.map((line) => line.trim()).filter((line, index, all) => line || (index > 0 && all[index - 1]));
    };
    document.querySelectorAll(".xp-text-w-inside .xp-text").forEach((el) => {
      const lines = readLines(el);
      // 去掉末尾空行
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      sections.push(lines);
    });
    return sections;
  }

  private _render(): void {
    const sections = this._extractSections();
    if (!sections.length) return;

    const dpr = this._dpr;
    this._mobile = window.innerWidth < 768;
    const fontSize = this._mobile ? 25 : 30;
    const lineHeight = this._mobile ? 40 : 48;
    // 测量
    const measurer = document.createElement("canvas").getContext("2d")!;
    measurer.font = `100 ${fontSize}px "Canela Text"`;
    let maxWidth = 0;
    let totalLines = 0;
    this.sectionRanges = [];
    let accLines = 0;
    sections.forEach((lines) => {
      this.sectionRanges.push({ min: 0, max: 0 }); // 稍后填充
      lines.forEach((l) => {
        maxWidth = Math.max(maxWidth, measurer.measureText(l).width);
        totalLines++;
      });
      accLines += lines.length + 1; // 节间空一行
    });
    totalLines += sections.length; // 节间距

    this.tileWidth = Math.ceil(maxWidth + TILE_PADDING * 2);
    this.contentWidth = this.tileWidth;
    this.contentHeight = totalLines * lineHeight + TILE_PADDING * 2;

    const canvas = document.createElement("canvas");
    canvas.width = this.tileWidth * 3 * dpr;
    canvas.height = this.contentHeight * dpr;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    this._canvas = canvas;
    this._ctx = ctx;

    const drawTile = (tileIndex: number, blur: number) => {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.translate(tileIndex * this.tileWidth, 0);
      ctx.filter = blur > 0 ? `blur(${blur}px)` : "none";
      ctx.font = `100 ${fontSize}px "Canela Text"`;
      ctx.fillStyle = "#000";
      ctx.textBaseline = "top";
      let y = TILE_PADDING;
      sections.forEach((lines, si) => {
        if (tileIndex === 0) {
          this.sectionRanges[si].min = (y - TILE_PADDING) / (this.contentHeight - TILE_PADDING * 2);
        }
        lines.forEach((line) => {
          if (line) ctx.fillText(line, TILE_PADDING, y);
          y += lineHeight;
        });
        if (tileIndex === 0) {
          this.sectionRanges[si].max = (y - TILE_PADDING) / (this.contentHeight - TILE_PADDING * 2);
        }
        y += lineHeight; // 节间距
      });
      ctx.restore();
    };

    drawTile(0, 0);
    drawTile(1, 2);
    drawTile(2, 6);

    this._imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.flipY = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
  }

  /**
   * 命中检测：四边形内 uv（0~1）+ 当前滚动进度 → 是否落在文字笔画上。
   * 对应原站 checkTextIntersection 的 UV 换算 + alpha 读取。
   */
  hitTest(uv: { x: number; y: number }, scrollProgress: number, windowHeight: number): boolean {
    if (!this._imageData || !this._canvas) return false;
    if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return false;
    const su = uv.x / 3; // 清晰瓦片
    const sv = (1 - uv.y) * windowHeight + scrollProgress * (1 - windowHeight);
    const px = Math.floor(su * this._canvas.width);
    const py = Math.floor(sv * this._canvas.height);
    if (px < 0 || px >= this._canvas.width || py < 0 || py >= this._canvas.height) return false;
    const alpha = this._imageData.data[(py * this._canvas.width + px) * 4 + 3];
    return alpha > 128;
  }

  resize(): void {
    const mobile = window.innerWidth < 768;
    if (mobile === this._mobile) return;
    this.texture?.dispose();
    this._render();
  }

  destroy(): void {
    this.texture?.dispose();
  }
}
