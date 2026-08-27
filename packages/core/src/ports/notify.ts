/**
 * NotifyPort — 通知接口
 *
 * 核心引擎通过此接口向用户推送状态变更。
 */

export type NotificationLevel = 'info' | 'warning' | 'error' | 'success'

export interface Notification {
  /** 通知级别 */
  level: NotificationLevel
  /** 标题 */
  title: string
  /** 详细内容 */
  message: string
  /** 关联的实体 ID */
  entityId?: string
  /** 关联的实体类型 */
  entityType?: 'task' | 'taskRun' | 'prWorkItem'
}

export interface NotifyPort {
  /** 通知用户 */
  notify(notification: Notification): void
}
