/**
 * ClockPort — 时间接口
 *
 * 核心引擎通过此接口获取当前时间，使业务逻辑可测试。
 */

export interface ClockPort {
  /** 当前时间 */
  now(): Date
}

/** 默认实现：使用系统时钟 */
export const systemClock: ClockPort = {
  now: () => new Date(),
}
