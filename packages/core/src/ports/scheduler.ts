/**
 * SchedulerPort — 定时调度接口
 *
 * 核心引擎通过此接口注册定时回调。
 * 不关心底层是 setTimeout、Cordis effect timer、系统 crontab 还是云函数。
 */

export type CancelFn = () => void

export interface SchedulerPort {
  /** 在指定时间触发回调，返回取消函数 */
  scheduleAt(time: Date, callback: () => Promise<void>): CancelFn
  /** 在指定延迟后触发回调，返回取消函数 */
  scheduleAfter(delayMs: number, callback: () => Promise<void>): CancelFn
}
