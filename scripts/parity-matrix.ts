import fs from 'node:fs/promises'
import path from 'node:path'

import fg from 'fast-glob'

import { extractVirtualUnits } from '../src/extract/markdown.js'
import { buildLineStarts } from '../src/utils/lines.js'
import {
  parityAssetsMissingMessage,
  resolveEslintMdxParityAssets,
} from '../tools/upstream-eslint-mdx.ts'

interface MatrixRow {
  fixture: string
  status: 'ok' | 'parse-error'
  parseError?: {
    message: string
    line: number
    column: number
  }
  units: {
    total: number
    fencedCode: number
    mdxEsm: number
    mdxFlowExpression: number
    mdxTextExpression: number
    mdxJsxAttributeExpression: number
    mdxJsxElement: number
  }
  languages: string[]
}

function countKinds(units: ReturnType<typeof extractVirtualUnits>) {
  return {
    total: units.length,
    fencedCode: units.filter((unit) => unit.kind === 'fenced-code').length,
    mdxEsm: units.filter((unit) => unit.kind === 'mdx-esm').length,
    mdxFlowExpression: units.filter((unit) => unit.kind === 'mdx-flow-expression').length,
    mdxTextExpression: units.filter((unit) => unit.kind === 'mdx-text-expression').length,
    mdxJsxAttributeExpression: units.filter((unit) => unit.kind === 'mdx-jsx-attribute-expression')
      .length,
    mdxJsxElement: units.filter((unit) => unit.kind === 'mdx-jsx-element').length,
  }
}

async function buildMatrix(fixturesRoot: string): Promise<MatrixRow[]> {
  const fixturePaths = await fg(['**/*.{md,mdx}'], {
    cwd: fixturesRoot,
    absolute: true,
    onlyFiles: true,
  })

  const rows: MatrixRow[] = []

  for (const fixturePath of fixturePaths) {
    const fixtureText = await fs.readFile(fixturePath, 'utf8')
    const relativePath = path.relative(fixturesRoot, fixturePath)

    try {
      const units = extractVirtualUnits(
        {
          filePath: fixturePath,
          text: fixtureText,
          lineStarts: buildLineStarts(fixtureText),
        },
        {
          languageMapper: {
            ecmascript: 'js',
            javascript: 'js',
            javascriptreact: 'jsx',
            typescript: 'ts',
            typescriptreact: 'tsx',
            markdown: 'md',
            markdownjsx: 'mdx',
            markdownreact: 'mdx',
          },
        },
      )

      rows.push({
        fixture: relativePath,
        status: 'ok',
        units: countKinds(units),
        languages: [...new Set(units.map((unit) => unit.language))].sort(),
      })
    } catch (err) {
      const caught =
        typeof err === 'object' && err !== null
          ? (err as {
              reason?: unknown
              message?: unknown
              line?: unknown
              column?: unknown
            })
          : undefined
      const errorMessage =
        typeof caught?.reason === 'string'
          ? caught.reason
          : typeof caught?.message === 'string'
            ? caught.message
            : err instanceof Error
              ? err.message
              : 'Unknown parse error'

      rows.push({
        fixture: relativePath,
        status: 'parse-error',
        parseError: {
          message: errorMessage,
          line: typeof caught?.line === 'number' ? caught.line : 1,
          column: typeof caught?.column === 'number' ? caught.column : 1,
        },
        units: {
          total: 0,
          fencedCode: 0,
          mdxEsm: 0,
          mdxFlowExpression: 0,
          mdxTextExpression: 0,
          mdxJsxAttributeExpression: 0,
          mdxJsxElement: 0,
        },
        languages: [],
      })
    }
  }

  return rows.sort((a, b) => a.fixture.localeCompare(b.fixture))
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

const matrix = await buildMatrix(upstream.fixturesRoot)
const summary = {
  totalFixtures: matrix.length,
  parsedFixtures: matrix.filter((row) => row.status === 'ok').length,
  parseErrors: matrix.filter((row) => row.status === 'parse-error').length,
}

process.stdout.write(
  `${JSON.stringify(
    {
      summary,
      paritySource: upstream.source,
      matrix,
    },
    null,
    2,
  )}\n`,
)
