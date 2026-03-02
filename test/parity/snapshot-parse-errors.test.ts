import fs from 'node:fs/promises'
import path from 'node:path'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { extractVirtualUnits } from '../../src/extract/markdown.js'
import { buildLineStarts } from '../../src/utils/lines.js'

const FIXTURES_ROOT = path.resolve(process.cwd(), '../eslint-mdx/test/fixtures')
const SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  '../eslint-mdx/test/__snapshots__/fixtures.test.ts.snap',
)

function parseExpectedParseErrorsFromSnapshot(snapshotText: string): string[] {
  const expected = new Set<string>()

  const entryRegex =
    /exports\[`fixtures should match all snapshots: (?<fixture>[^`]+?) 1`\] = `(?<body>[\s\S]*?)`;\n/gu

  for (const match of snapshotText.matchAll(entryRegex)) {
    const fixture = match.groups?.fixture?.trim()
    const body = match.groups?.body ?? ''

    if (!fixture || !/\.(?:md|mdx)$/u.test(fixture)) {
      continue
    }

    if (body.includes('"fatal": true')) {
      expected.add(fixture)
    }
  }

  return [...expected].sort()
}

describe('parity matrix (snapshot-driven)', () => {
  it('matches upstream fatal parse-error fixture set from snapshot', async () => {
    const [snapshotText, fixtures] = await Promise.all([
      fs.readFile(SNAPSHOT_PATH, 'utf8'),
      fg(['**/*.{md,mdx}'], {
        cwd: FIXTURES_ROOT,
        absolute: true,
        onlyFiles: true,
      }),
    ])

    const expectedParseErrorFixtures = parseExpectedParseErrorsFromSnapshot(snapshotText)

    const actualParseErrorFixtures: string[] = []

    for (const fixturePath of fixtures) {
      const text = await fs.readFile(fixturePath, 'utf8')

      try {
        extractVirtualUnits(
          {
            filePath: fixturePath,
            text,
            lineStarts: buildLineStarts(text),
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
      } catch {
        actualParseErrorFixtures.push(path.relative(FIXTURES_ROOT, fixturePath))
      }
    }

    expect(actualParseErrorFixtures.sort()).toEqual(expectedParseErrorFixtures)
  })
})
