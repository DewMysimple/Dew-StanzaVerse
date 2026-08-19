/**
 * 极简事件总线。
 * 原站使用自家模块注册表（tY.register / globals）做跨模块通信，
 * 复刻版用一个类型宽松的事件总线替代，职责相同：解耦 Loader / Experience / DOM 组件。
 */
export type EventHandler = (payload?: unknown) => void;

export class EventBus {
  private _handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): void {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this._handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    this._handlers.get(event)?.forEach((h) => h(payload));
  }
}

/** 全局单例：全应用共用一条事件总线 */
export const bus = new EventBus();

/** 事件名常量（对齐原站事件命名） */
export const EVENTS = {
  /** Loader 完成、用户点击进入，启动水彩场景 */
  START_WATERCOLOR: "start-watercolor-scene",
  /** 从权益区重启体验 */
  RESTART_WATERCOLOR: "restart-watercolor-scene",
  /** 资源加载进度（0~1） */
  RESOURCES_PROGRESS: "resources-progress",
  /** 资源加载完成 */
  RESOURCES_COMPLETE: "resources-complete",
  /** 滚动进入权益区 */
  SHOW_OFFERS: "show-offers",
  /** 滚动离开权益区 */
  HIDE_OFFERS: "hide-offers",
} as const;
