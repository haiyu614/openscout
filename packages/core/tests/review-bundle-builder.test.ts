/**
 * ReviewBundleBuilder 单测（纯逻辑）。
 */
import { describe, it, expect } from 'vitest'
import { buildReviewBundle, type BuildContext } from '../src/engines/contrib/review-bundle-builder.js'
import type { ValidationResult } from '../src/ports/agent.js'

function base(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    repository: { owner: 'octocat', name: 'hello' },
    issue: { number: 7, title: 'Add tests', url: 'https://github.com/octocat/hello/issues/7' },
    branchName: 'openscout/contrib',
    intent: '为 hello 项目补充单元测试覆盖率',
    diff: '@@ -1,2 +1,3 @@\n+test',
    changedFiles: ['src/a.test.ts'],
    validations: [],
    summary: '补充了核心模块单元测试',
    generatedAt: '2026-01-01T00:00:00Z',
    version: 1,
    ...overrides,
  }
}

describe('buildReviewBundle', () => {
  it('规范化 PR 标题并引用 Issue 编号', () => {
    const b = buildReviewBundle(base())
    expect(b.prTitle).toContain('#7')
    expect(b.prTitle.startsWith('OpenScout:')).toBe(true)
  })

  it('PR 正文包含意图、Issue 链接与验证汇总', () => {
    const b = buildReviewBundle(base())
    expect(b.prBody).toContain('为 hello 项目补充单元测试覆盖率')
    expect(b.prBody).toContain('https://github.com/octocat/hello/issues/7')
    expect(b.prBody).toContain('## 变更摘要')
  })

  it('提交信息带 fix #issue 引用', () => {
    const b = buildReviewBundle(base())
    expect(b.commitMessage).toContain('fix #7')
  })

  it('所有验证通过时 risks 为空、skipped 为空', () => {
    const validations: ValidationResult[] = [
      { command: 'npm test', passed: true, output: 'ok' },
    ]
    const b = buildReviewBundle(base({ validations }))
    expect(b.validations).toHaveLength(1)
    expect(b.skippedValidations).toHaveLength(0)
    expect(b.risks).toHaveLength(0)
  })

  it('验证失败进入 risks 与 skippedValidations', () => {
    const validations: ValidationResult[] = [
      { command: 'npm test', passed: false, error: '1 failed' },
    ]
    const b = buildReviewBundle(base({ validations }))
    expect(b.skippedValidations.length).toBe(1)
    expect(b.risks.some(r => r.includes('验证未通过'))).toBe(true)
  })

  it('改动文件过多时标注风险', () => {
    const files = Array.from({ length: 12 }, (_, i) => `f${i}.ts`)
    const b = buildReviewBundle(base({ changedFiles: files }))
    expect(b.risks.some(r => r.includes('改动文件较多'))).toBe(true)
  })

  it('手动贡献（无 Issue）时 PR 文案不带编号', () => {
    const b = buildReviewBundle(base({ issue: undefined }))
    expect(b.prTitle).not.toContain('#')
  })

  it('输出通过 ReviewBundle schema 校验', () => {
    const b = buildReviewBundle(base())
    expect(() => JSON.parse(JSON.stringify(b))).not.toThrow()
    expect(typeof b.generatedAt).toBe('string')
  })
})
