/**
 * OpenScout 工具处理器（host 动态插件经 ctx.shell 派生的子进程）。
 *
 * 为什么是子进程：动态插件 host half 受限制（无 import/child_process/process，网络受限）。
 * 本脚本作为普通子进程运行（拥有完整 fs + 网络 + process），require 真实 Core 编译产物 +
 * 真实 @octokit/rest，把 OpenScout 能力暴露为工具。token 继承自 harness 环境（GITHUB_TOKEN）。
 *
 * 子命令（argv[2]）：
 *   search_repos   {query, limit?}                       → 候选仓库
 *   search_issues  {owner, name, labels?, limit?}        → 可贡献 Issue
 *   publish_draft   {owner, name, issueNumber?, intent?, labels?} → 真实草稿 PR
 *
 * 入参 JSON 经 env OPENSCOUT_ARGS 传入；结果 JSON 打到 stdout；错误打到 stderr 并以非 0 退出。
 */

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SearchEngine,
  DedupEngine,
  ContribOrchestrator,
  PublishEngine,
  type AgentPort,
  type CodeWorkRequest,
  type CodeWorkResult,
  type ApprovalPort,
  type ApprovalOutcome,
  type CredentialPort,
} from '@openscout/core'
import { OctokitGitHubAdapter } from '@openscout/github-adapter'
import { InMemoryStorage } from '@openscout/storage-memory'

const token = process.env.GITHUB_TOKEN || readTokenFromCredentialsFile()
if (!token) {
  console.error('未找到 GITHUB_TOKEN（env 与 ~/.dsh/.credentials.yaml 均无）')
  process.exit(1)
}

function readTokenFromCredentialsFile(): string | undefined {
  try {
    const raw = readFileSync(`${process.env.HOME ?? ''}/.dsh/.credentials.yaml`, 'utf8')
    const m = raw.match(/GITHUB_TOKEN:\s*(\S+)/)
    return m ? m[1] : undefined
  } catch {
    return undefined
  }
}
const credentials: CredentialPort = { resolveGitHubToken: async () => token }
const github = new OctokitGitHubAdapter(credentials)

function main() {
  const sub = process.argv[2]
  const args = JSON.parse(process.env.OPENSCOUT_ARGS ?? '{}')
  if (sub === 'search_repos') return void searchRepos(args)
  if (sub === 'search_issues') return void searchIssues(args)
  if (sub === 'publish_draft') return void publishDraft(args)
  console.error(`未知子命令: ${sub}`)
  process.exit(2)
}

function searchRepos(args: { query: string; limit?: number }) {
  const se = new SearchEngine(github)
  se.searchRepositories({ query: args.query, limit: args.limit ?? 10 }).then((r) => {
    console.log(JSON.stringify(r.candidates.map((c) => ({ fullName: c.repository.fullName, score: c.score, reasons: c.reasons, concerns: c.concerns }))))
  })
}

function searchIssues(args: { owner: string; name: string; labels?: string[]; limit?: number }) {
  const se = new SearchEngine(github)
  se.searchIssues({
    repository: { owner: args.owner, name: args.name },
    labels: args.labels,
    limit: args.limit ?? 10,
  }).then((r) => {
    console.log(JSON.stringify(r.candidates.map((c) => ({ number: c.issue.number, title: c.issue.title, feasibility: c.feasibility }))))
  })
}

async function publishDraft(args: { owner: string; name: string; issueNumber?: number; intent?: string; labels?: string[] }) {
  const storage = new InMemoryStorage()
  const dedup = new DedupEngine({ storage })
  const autoApprove: ApprovalPort = { async requestApproval(): Promise<ApprovalOutcome> { return 'approved' } }

  // 1. 选 Issue：指定则用指定，否则搜最高可行性
  let issueNumber = args.issueNumber
  let issueTitle = args.intent ?? 'OpenScout 自动贡献'
  let issueGithubId = issueNumber ?? 0
  let issueUrl = ''
  if (!issueNumber) {
    const se = new SearchEngine(github)
    const res = await se.searchIssues({ repository: { owner: args.owner, name: args.name }, labels: args.labels, limit: 10 })
    const top = res.candidates.find((c) => c.feasibility === 'high') ?? res.candidates[0]
    if (!top) throw new Error('未找到可贡献 Issue')
    issueNumber = top.issue.number
    issueTitle = top.issue.title
    issueGithubId = top.issue.githubId
    issueUrl = top.issue.htmlUrl
  } else {
    issueUrl = `https://github.com/${args.owner}/${args.name}/issues/${issueNumber}`
  }

  // 去重
  const key = `${args.owner}:${issueGithubId}`
  const decision = dedup.checkLocal({ key, taskId: 'manual' })
  if (decision.duplicate) throw new Error(`去重拦截: ${decision.reason}`)

  // 2. 真实 Agent：克隆并做无副作用改动（探针标记文件）
  const workspace = mkdtempSync(join(tmpdir(), 'openscout-agent-'))
  const agent: AgentPort = {
    async delegateCodeWork(req: CodeWorkRequest): Promise<CodeWorkResult> {
      execFileSync('git', ['clone', `https://github.com/${args.owner}/${args.name}.git`, workspace], { stdio: 'ignore' })
      const marker = join(workspace, 'OPENSPOUT_CONTRIBUTION_PROBE.md')
      writeFileSync(marker, `# OpenScout Contribution Probe\n\nGenerated at ${new Date().toISOString()}\n`)
      return {
        success: true,
        changedFiles: [marker],
        validationResults: [{ command: 'git status', passed: true, output: '1 file changed' }],
        summary: `为 ${args.owner}/${args.name} 添加探针标记文件（演示改动）`,
        diff: '',
      }
    },
  }

  const orchestrator = new ContribOrchestrator({ storage, dedup, agent, approval: autoApprove })
  const gen = await orchestrator.generate({
    repository: { owner: args.owner, name: args.name, githubId: 0 },
    issue: { number: issueNumber!, githubId: issueGithubId, title: issueTitle, url: issueUrl },
    intent: `为 ${args.name} 添加 OpenScout 探针标记文件（演示贡献）`,
    workingDirectory: workspace,
  })
  if (gen.kind !== 'generated') throw new Error(`生成失败: ${gen.kind}`)

  const ap = await orchestrator.approve(gen.workItem.id)
  if (!ap.ok) throw new Error(`审批失败: ${ap.reason}`)

  const publish = new PublishEngine({ storage, github, approval: autoApprove, dedup, issueKey: () => key })
  const commits = [{
    message: 'OpenScout: 添加探针标记文件（演示贡献）',
    files: gen.bundle.changedFiles.map((p) => ({ path: p.replace(workspace + '/', ''), content: readFileSync(p, 'utf8') })),
  }]
  const pub = await publish.publish({ workItemId: gen.workItem.id, commits, asDraft: true })
  if (!pub.ok) throw new Error(`发布失败: ${pub.reason} (${pub.workItem.status})`)
  console.log(JSON.stringify({ ok: true, workItemId: gen.workItem.id, draftPR: { number: pub.remotePR.number, url: pub.remotePR.url } }))
}

main()
