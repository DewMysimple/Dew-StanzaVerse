# 页面构造与逻辑分析

## 1. 总体架构

页面不是单一的 WebGL Demo，而是三层组合：

```text
WordPress/PHP 服务端模板
        │ 输出 HTML、正文、购买区、全局配置
        ▼
DOM 组件层（data-component 注册）
        │ Loader / Cursor / Advantages / WatercolorExperience
        ▼
Canvas 体验层（Three.js + GSAP）
          场景、纹理、文字网格、后期处理、状态转场、音频
```

HTML 是 WordPress 主题模板的服务端输出。核心体验挂在 `data-component="WatercolorExperience"` 的页面容器上；主 Canvas 是 `.xp-canvas`，诗句的语义副本和尺寸参考留在 `.xp-section` 中，订阅权益区则由 `data-component="Advantages"` 管理。

生产包内嵌了 Three.js r149 和 GSAP 3.14.2，并包含 ScrollTrigger、ScrollSmoother、SplitText、Draggable 等 GSAP 插件代码。页面另外加载 WordPress/WooCommerce/MemberPress、Mapbox 和支付相关全局依赖，但水彩体验的核心主要在主题 `app.js` 内。

## 2. 启动顺序

```text
页面组件扫描
  → LoaderExperience 初始化独立加载画面
  → 资源管理器预载模型/纹理/LUT/字体图集
  → Loader 完成并发出 start-watercolor-scene
  → WatercolorExperience.start()
  → ExperienceManager 启动渲染循环
  → 激活 Watercolor View + UI Overlay
  → Canvas 用 GSAP 由透明淡入
```

关键入口位于格式化主包：

- `LoaderExperience` 导出注册：约第 3,451 行。
- Loader 完成并发出 `start-watercolor-scene`：约第 182,520 行。
- `WatercolorExperience` 外层编排组件：约第 174,130 行。
- `ExperienceManager` 的初始化、启动和状态转场：约第 173,520 行。

加载器并不只是 DOM 进度条，它也建立一个轻量 WebGL 入口效果。主资源完成后，Loader 销毁自己的 WebGL，再把控制权交给正式体验。

## 3. 资源管线

主包将资源根目录设为：

```text
./wp-content/themes/davidwhyte/resources/assets
```

资源管理器注册了 GLTF、OBJ、3DL、纹理、图片、EXR 和 JSON 等加载器。体验使用的主要资源包括：

- `xp/models/scene.glb`：场景几何体。
- `xp/textures/atlas/*`：场景图集、遮罩与 SDF。
- `xp/textures/grounds/atlas.ktx2`：压缩地表纹理。
- `xp/lut/*.3DL`：水墨/干燥色彩查找表。
- `xp/msdf/CanelaText-Light/*`：MSDF 字体图集与字符数据。
- `xp/poem/text.png`：诗句相关纹理。
- `xp/videos/{desktop|mobile}/{base|over}/1..6.mp4`：两层动态绘画纹理。
- `xp/sounds/*.mp3`：主场景、诗歌、绘画模式的循环声景和按钮音效。

KTX2 解码通过 `basis_transcoder.js` 和 `basis_transcoder.wasm` 完成。桌面与移动端会选择不同分辨率的视频组；每组又分 base/over 两层，在交互时混合或切换。

## 4. 状态与转场

`ExperienceManager` 保存一个显式的 `transitionState`：

```text
fromView / toView
fromOverlay / toOverlay
inTransition
meta: restart | showPoem | hidePoem | poemToOffers
```

主要状态流为：

```text
Watercolor + UI
  ├─ 点击/命中诗句 → Poem 全屏视图 → 返回 → Watercolor + UI
  ├─ 长按绘画区域 → Full Paint 展开 → Back → Watercolor + UI
  └─ 继续向下滚动 → poemToOffers → DOM Advantages/订阅权益区
                                  └─ Restart → 重置 Canvas 与滚动位置
```

所有复杂切换都先写入 `transitionState`，在 GSAP Timeline 中隐藏当前 View/Overlay、切换音频与雾状态、显示目标 View，最后清空转场状态。`isPaintInteractionEnabled` 会同时检查“是否启动、是否正在转场、当前 View/Overlay、是否已进入优惠区、是否正在展示诗句或全幅绘画”，避免多个交互互相抢占。

## 5. 交互实现

- 鼠标/触摸：自定义 Cursor 组件监听移动、按下、抬起与目标命中；移动端长按阈值约 0.6 秒，桌面约 0.3 秒。
- 滚动：页面临时调整平滑滚动器的 wheel/touch multiplier；内部滚动状态控制 Canvas 段落进度和 View 转换。
- 动画：GSAP Timeline 负责 Canvas 淡入、View 交叉切换、雾参数、镜头缩放、按钮和权益区显隐。
- 权益区：普通 DOM 内容，使用 `IntersectionObserver` 给进入视口的标题、步骤和 CTA 添加 `.show`；桌面端再用 GSAP ticker 做轻量视差。
- 音频：使用 HTML `<audio>` 元素而不是 Web Audio 封装库；首次用户点击后才允许播放，并以 GSAP 动画淡入/淡出 `volume`。
- 文字：HTML 中保留两份诗句结构；一份参与布局/测量，另一份用于生成 Canvas/MSDF 文字。这样既能保持语义内容，也能让 WebGL 文字与真实排版对齐。

## 6. CSS 与视觉结构

主题 CSS 是全站合并产物，不只包含该页面。建议直接跳到格式化 CSS 的这些位置：

- `.xp-canvas`：约第 8,881 行。
- `.xp-section` 与文字层：约第 8,895 行。
- `.xp-btn`：约第 9,069 行。
- `.advantages-section`：约第 9,134 行。
- `.xp-restart`：约第 9,412 行。

页面使用 Canela Text 作为展示衬线体、Roobert 作为功能性无衬线体。HTML/DOM 负责可访问文本、按钮和订阅区；Canvas 负责具有“纸张、墨迹、雾、草地与视频绘画层”的视觉体验，这种职责拆分是本页面最值得学习的地方。

## 7. 推荐阅读顺序

1. 先看 HTML 第 459–641 行，理解 Loader、Canvas、隐藏资产、诗句 DOM 和权益区的关系。
2. 看格式化 CSS 第 8,881–9,451 行，理解 DOM 叠层与响应式布局。
3. 看主包第 174,130 行附近的 `WatercolorExperience`，掌握外层事件编排。
4. 看第 173,520 行附近的 `ExperienceManager`，梳理状态机和转场。
5. 看第 180,240 行附近的资源注册与加载器。
6. 最后再深入第 157,000–173,500 行的 WebGL View、材质、镜头、绘画命中和后期处理实现。

由于生产变量已压缩，最有效的阅读方法是从可识别的字符串（DOM selector、资源路径、事件名、`meta` 状态名）向上追踪调用链，而不是从文件第一行顺序阅读。

## 8. 无法从公开前端取得的部分

- WordPress 主题的 PHP 原文件与构建前的 JS/SCSS 源文件。
- 未公开的 source map、原始模块名、注释和设计源文件。
- MemberPress/WooCommerce 的服务端业务逻辑、数据库与会员内容。
- 第三方服务后台配置和密钥。

这些内容没有尝试绕过权限获取；当前包已经覆盖浏览器公开收到的页面构造、主题构建产物和水彩体验运行资源。
