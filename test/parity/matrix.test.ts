import fs from 'node:fs/promises'
import path from 'node:path'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { extractVirtualUnits } from '../../src/extract/markdown.js'
import { buildLineStarts } from '../../src/utils/lines.js'

const FIXTURES_ROOT = path.resolve(process.cwd(), '../eslint-mdx/test/fixtures')

describe('parity matrix', () => {
  it('matches upstream parse-error fixture set', async () => {
    const fixtures = await fg(['**/*.{md,mdx}'], {
      cwd: FIXTURES_ROOT,
      absolute: true,
      onlyFiles: true,
    })

    const parseErrorFixtures: string[] = []

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
        parseErrorFixtures.push(path.relative(FIXTURES_ROOT, fixturePath))
      }
    }

    expect(parseErrorFixtures.sort()).toEqual(['acorn.mdx', 'comments.mdx', 'details.mdx'])
  })
})
