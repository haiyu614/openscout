import { describe, it, expect } from 'vitest'
import { parseCron, parseEvery, nextOccurrence } from '../src/engines/cron.js'

describe('cron 解析', () => {
  it('解析 5 字段', () => {
    const p = parseCron('5 4 * * *')
    expect(p.minute).toEqual([5])
    expect(p.hour).toEqual([4])
    expect(p.dom.length).toBe(31)
    expect(p.dow.length).toBe(7)
  })

  it('支持 */N 步长', () => {
    const p = parseCron('*/15 9-17 * * 1-5')
    expect(p.minute).toEqual([0, 15, 30, 45])
    expect(p.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(p.dow).toEqual([1, 2, 3, 4, 5])
  })

  it('字段越界抛错', () => {
    expect(() => parseCron('99 * * * *')).toThrow()
  })

  it('非 5 字段抛错', () => {
    expect(() => parseCron('* * *')).toThrow()
  })

  it('@every 解析为毫秒', () => {
    expect(parseEvery('@every 30m')).toBe(1_800_000)
    expect(parseEvery('@every 1d')).toBe(86_400_000)
    expect(() => parseEvery('bad')).toThrow()
  })
})

describe('nextOccurrence 时区计算', () => {
  const tz = 'Asia/Shanghai'
  it('@every 在当前之后', () => {
    const next = nextOccurrence('@every 30m', new Date('2024-01-01T00:00:05Z'), tz)
    expect(next?.toISOString()).toBe('2024-01-01T00:30:05.000Z')
  })
  it('每日 09:00 Asia/Shanghai 落在 01:00 UTC', () => {
    const next = nextOccurrence('0 9 * * *', new Date('2024-06-14T23:00:00Z'), tz)
    expect(next?.toISOString()).toBe('2024-06-15T01:00:00.000Z')
  })
  it('每小时 :30 取下一个', () => {
    const next = nextOccurrence('30 * * * *', new Date('2024-06-15T01:10:00Z'), tz)
    expect(next?.toISOString()).toBe('2024-06-15T01:30:00.000Z')
  })
  it('不返回当前或过去时刻', () => {
    const after = new Date('2024-06-15T01:30:00Z')
    const next = nextOccurrence('30 * * * *', after, tz)
    expect(next!.getTime()).toBeGreaterThan(after.getTime())
  })
})
