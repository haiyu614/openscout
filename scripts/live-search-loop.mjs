/**
 * M2 真实闭环验证（主机侧，使用已编译的 Core + GitHub Adapter 直连 GitHub）。
 *
 * 不依赖 DSH 沙箱网络；用真实 token 运行 Core SearchEngine，证明
 * 「GitHub 原始结果 → 可解释评分/可行性」这一核心闭环逻辑在真实 API 下成立。
 * 适配器层（DSH 服务接线）由动态 Cordis 插件单独验证。
 */
import { SearchEngine, systemClock } from '@openscout/core'
import { OctokitGitHubAdapter } from '@openscout/github-adapter'

const token = process.env.GITHUB_TOKEN
if (!token) { console.error('GITHUB_TOKEN not set'); process.exit(2) }

const creds = { resolveGitHubToken: async () => token }
const github = new OctokitGitHubAdapter(creds)
const engine = new SearchEngine(github, systemClock)

const repos = await engine.searchRepositories({
  query: 'cli scaffolding', language: 'typescript', minStars: 500, perPage: 3,
})
console.log('=== searchRepositories (real GitHub) ===')
console.log('totalFound =', repos.totalFound)
for (const c of repos.candidates) {
  console.log(`- ${c.repository.fullName} stars=${c.repository.stars} score=${c.score}`)
  console.log(`    reasons: ${c.matchReasons.join('; ')}`)
  if (c.concerns.length) console.log(`    concerns: ${c.concerns.join('; ')}`)
}

const issues = await engine.searchIssues({
  repository: { owner: 'vitest-dev', name: 'vitest' },
  keywords: 'good first issue', limit: 3,
})
console.log('\n=== searchIssues (real GitHub) ===')
console.log('totalFound =', issues.totalFound)
for (const c of issues.candidates) {
  console.log(`- #${c.issue.number} ${c.issue.title} -> feasibility=${c.feasibility}`)
  console.log(`    reasons: ${c.reasons.join('; ')}`)
  if (c.blockers.length) console.log(`    blockers: ${c.blockers.join('; ')}`)
}
console.log('\nM2_LIVE_LOOP_OK')
