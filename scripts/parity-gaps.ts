import fs from 'node:fs/promises'

import { execa } from 'execa'

import {
  parityAssetsMissingMessage,
  resolveEslintMdxParityAssets,
} from '../tools/upstream-eslint-mdx.ts'

function parseOxlintRulesOutput(stdout: string): string[] {
  const parsed = JSON.parse(stdout)

  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (entry) => typeof entry !== 'object' || entry === null || typeof entry.value !== 'string',
    )
  ) {
    throw new TypeError('Invalid Oxlint --rules JSON output')
  }

  return parsed.map((rule) => rule.value)
}

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
  const upstream = await resolveEslintMdxParityAssets()
  if (!upstream) {
    return []
  }

  const { snapshotPath } = upstream
  const snapshotText = await fs.readFile(snapshotPath, 'utf8')
  const rules = [...snapshotText.matchAll(/"ruleId": "([^"]+)"/gu)].map((match) => match[1])
  return [...new Set(rules)].sort()
}

async function getOxlintRules(): Promise<Set<string>> {
  const result = await execa('pnpm', ['dlx', 'oxlint', '--rules', '-f', 'json'], {
    cwd: process.cwd(),
  })
  return new Set(parseOxlintRulesOutput(result.stdout))
}

const upstream = await resolveEslintMdxParityAssets()

if (!upstream) {
  process.stdout.write(
    `${JSON.stringify(
      {
        skipped: true,
        reason: parityAssetsMissingMessage(),
      },
      null,
      2,
    )}\n`,
  )
  process.exit(0)
}

const [snapshotRules, oxlintRules] = await Promise.all([getSnapshotRuleIds(), getOxlintRules()])

const remainingUnsupported = snapshotRules.filter((ruleId) => {
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
      paritySource: upstream.source,
      remainingUnsupported,
    },
    null,
    2,
  )}\n`,
)
