import fs from 'node:fs/promises'
import path from 'node:path'

import { execa } from 'execa'

const SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  '../eslint-mdx/test/__snapshots__/fixtures.test.ts.snap',
)

const REMARK_COVERED_RULES = new Set([
  'remark-lint-fenced-code-flag',
  'remark-lint-no-duplicate-headings-in-section',
  'remark-lint-no-multiple-toplevel-headings',
  'remark-validate-links:missing-file-missing-file',
])

function normalizeRuleId(ruleId: string): string {
  if (ruleId.includes(':')) {
    return ruleId.split(':').pop() ?? ruleId
  }
  if (ruleId.includes('/')) {
    return ruleId.split('/').pop() ?? ruleId
  }
  return ruleId
}

async function getSnapshotRuleIds(): Promise<string[]> {
  const snapshotText = await fs.readFile(SNAPSHOT_PATH, 'utf8')
  const rules = [...snapshotText.matchAll(/"ruleId": "([^"]+)"/gu)].map(match => match[1])
  return [...new Set(rules)].sort()
}

async function getOxlintRules(): Promise<Set<string>> {
  const result = await execa('pnpm', ['dlx', 'oxlint', '--rules', '-f', 'json'], {
    cwd: process.cwd(),
  })
  const parsed = JSON.parse(result.stdout) as Array<{ value: string }>
  return new Set(parsed.map(rule => rule.value))
}

const [snapshotRules, oxlintRules] = await Promise.all([getSnapshotRuleIds(), getOxlintRules()])

const remainingUnsupported = snapshotRules.filter(ruleId => {
  if (REMARK_COVERED_RULES.has(ruleId)) {
    return false
  }

  const normalized = normalizeRuleId(ruleId)
  return !oxlintRules.has(normalized)
})

process.stdout.write(
  `${JSON.stringify(
    {
      snapshotRuleCount: snapshotRules.length,
      remainingUnsupportedCount: remainingUnsupported.length,
      remainingUnsupported,
    },
    null,
    2,
  )}\n`,
)
