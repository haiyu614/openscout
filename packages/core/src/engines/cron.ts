/**
 * cron.ts — Cron / @every 表达式解析与下一次触发计算（纯逻辑）
 *
 * 支持两种形式：
 *   1. 标准 5 字段 cron：`分 时 日 月 周`（支持 `*`、步长 `*\/N`、单值 `N`、区间 `N-M`、枚举 `N,M`）
 *   2. `@every <时长>`：`@every 30m` / `@every 6h` / `@every 1d`（相对间隔）
 *
 * 不依赖任何宿主框架，纯函数，便于单测。时区通过 Intl API 计算墙钟字段。
 */

export type CronField = number[] // 命中的取值集合

export interface ParsedCron {
  kind: 'cron'
  minute: CronField
  hour: CronField
  dom: CronField // day of month 1-31
  month: CronField // 1-12
  dow: CronField // 0-6, 0=Sun
}

const FIELD_BOUNDS: Array<{ min: number; max: number }> = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // dom
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // dow
]

function parseField(raw: string, index: number): CronField {
  const { min, max } = FIELD_BOUNDS[index]
  if (raw.trim() === '*') {
    const all: number[] = []
    for (let i = min; i <= max; i++) all.push(i)
    return all
  }
  const set = new Set<number>()
  for (const part of raw.split(',')) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/')
      const step = Number(stepStr)
      if (!Number.isInteger(step) || step <= 0) throw new Error(`invalid step: ${part}`)
      let lo = min
      let hi = max
      if (range.trim() !== '*') {
        if (range.includes('-')) {
          const [a, b] = range.split('-').map(Number)
          lo = a; hi = b
        } else {
          lo = Number(range); hi = max
        }
      }
      for (let i = lo; i <= hi; i += step) set.add(i)
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number)
      for (let i = a; i <= b; i++) set.add(i)
    } else {
      set.add(Number(part))
    }
  }
  for (const v of set) {
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`field out of range: ${raw}`)
  }
  return [...set].sort((a, b) => a - b)
}

/** 解析 cron 表达式；非法抛错 */
export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`cron 需要 5 个字段，收到 ${fields.length}: "${expr}"`)
  const [minute, hour, dom, month, dow] = fields.map((f, i) => parseField(f, i))
  return { kind: 'cron', minute, hour, dom, month, dow }
}

/** 解析 @every 时长（30m / 6h / 1d / 90s）为毫秒 */
export function parseEvery(expr: string): number {
  const m = expr.trim().match(/^@every\s+(\d+)(s|m|h|d)$/)
  if (!m) throw new Error(`无法解析 @every 表达式: "${expr}"`)
  const n = Number(m[1])
  const unit = m[2]
  const mul = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return n * mul
}

function wallParts(date: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; w: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false,
  })
  const parts = fmt.formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  let h = Number(get('hour'))
  if (h === 24) h = 0 // 某些环境 hour12:false 仍可能返回 24
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    y: Number(get('year')),
    mo: Number(get('month')),
    d: Number(get('day')),
    h,
    mi: Number(get('minute')),
    w: wdMap[get('weekday')] ?? 0,
  }
}

function isValidDate(y: number, mo: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/** 判断某天是否匹配 dom/dow（cron 语义：dom 或 dow 命中其一，或其中一个为 *） */
function dayMatches(parsed: ParsedCron, dom: number, dow: number): boolean {
  const domStar = parsed.dom.length === 31
  const dowStar = parsed.dow.length === 7
  const domHit = parsed.dom.includes(dom)
  const dowHit = parsed.dow.includes(dow)
  if (domStar && dowStar) return true
  if (domStar) return dowHit
  if (dowStar) return domHit
  return domHit || dowHit
}

/**
 * 计算下一次触发时间（严格晚于 `after`）。
 * @returns 触发 Date，或 null（在 400 天窗口内无解）
 */
export function nextOccurrence(expr: string, after: Date, timezone: string): Date | null {
  if (expr.trim().startsWith('@every')) {
    const ms = parseEvery(expr)
    return new Date(after.getTime() + ms)
  }
  const parsed = parseCron(expr)
  // 从 after 当天开始逐日扫描，最多 400 天
  const start = new Date(after.getTime())
  // 对齐到秒，避免 floating
  start.setUTCMilliseconds(0)
  for (let dayOffset = 0; dayOffset < 400; dayOffset++) {
    const dayDate = new Date(start.getTime() + dayOffset * 86_400_000)
    const wp = wallParts(dayDate, timezone)
    if (!dayMatches(parsed, wp.d, wp.w)) continue
    if (!parsed.month.includes(wp.mo)) continue
    // 当天候选分钟
    for (const hOfDay of parsed.hour) {
      if (dayOffset === 0 && hOfDay < wp.h) continue
      for (const mi of parsed.minute) {
        if (dayOffset === 0 && hOfDay === wp.h && mi <= wp.mi) continue
        const candidate = new Date(Date.UTC(wp.y, wp.mo - 1, wp.d, hOfDay, mi, 0, 0))
        // 将候选转为该时区的真实 UTC 时刻（通过重新格式化的反向：用 wallParts 校验后直接构造 UTC 近似）
        // 简化：以 UTC 构造后校验 wall 字段一致（处理 DST 边界时可能偏差，但落在合法桶内）
        const cand = toTzInstant(wp.y, wp.mo, wp.d, hOfDay, mi, timezone)
        if (cand > after) return cand
      }
    }
  }
  return null
}

/** 根据墙钟字段构造对应时区的真实 UTC 时刻（处理时区偏移与 DST） */
function toTzInstant(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  if (!isValidDate(y, mo, d)) {
    // 不该发生，防御
    return new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0))
  }
  // 用当天中午做偏移探测，覆盖 DST 翻转
  const probeUTC = Date.UTC(y, mo - 1, d, 12, 0, 0, 0)
  const p = wallParts(new Date(probeUTC), tz)
  // 该时区相对 UTC 的偏移（小时）
  const offsetHours = (p.y === y && p.mo === mo && p.d === d)
    ? p.h - 12
    : 0
  // 直接构造墙钟对应的 UTC 近似
  let utcMs = Date.UTC(y, mo - 1, d, h, mi, 0, 0) - offsetHours * 3_600_000
  // 微调：若偏移为非整数小时，Intl 仍给出整数分钟偏移，这里用分钟级修正
  const approx = new Date(utcMs)
  const wp = wallParts(approx, tz)
  const driftMin = (wp.h - h) * 60 + (wp.mi - mi)
  utcMs -= driftMin * 60_000
  return new Date(utcMs)
}
