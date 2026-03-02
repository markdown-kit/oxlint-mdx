import fs from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { extractVirtualUnits } from '../../src/extract/markdown.js'
import { buildLineStarts } from '../../src/utils/lines.js'

const FIXTURE_ROOT = path.resolve(process.cwd(), '../eslint-mdx/test/fixtures')

async function readFixture(relativePath: string) {
  const filePath = path.join(FIXTURE_ROOT, relativePath)
  const text = await fs.readFile(filePath, 'utf8')
  return {
    filePath,
    text,
  }
}

describe('parity: upstream eslint-mdx fixtures', () => {
  it('handles basic.mdx and extracts mixed unit kinds', async () => {
    const fixture = await readFixture('basic.mdx')
    const units = extractVirtualUnits(
      {
        filePath: fixture.filePath,
        text: fixture.text,
        lineStarts: buildLineStarts(fixture.text),
      },
      {
        languageMapper: {
          javascript: 'js',
          css: 'css',
        },
      },
    )

    expect(units.some((unit) => unit.kind === 'mdx-esm')).toBe(true)
    expect(units.some((unit) => unit.kind === 'fenced-code')).toBe(true)
    expect(units.some((unit) => unit.kind === 'mdx-jsx-element')).toBe(true)
  })

  it('preserves code-fence filename metadata for virtual unit naming', async () => {
    const fixture = await readFixture('code-blocks/455.mdx')
    const units = extractVirtualUnits(
      {
        filePath: fixture.filePath,
        text: fixture.text,
        lineStarts: buildLineStarts(fixture.text),
      },
      {
        languageMapper: {
          javascript: 'js',
        },
      },
    )

    const fenced = units.find((unit) => unit.kind === 'fenced-code')
    expect(fenced).toBeDefined()
    expect(fenced?.virtualFilePath).toBe('test.js')
  })

  it('normalizes whitespace in code-fence filename metadata', async () => {
    const source = [
      '```js filename="my test file.js"',
      'const value = 1',
      '```',
      '',
    ].join('\n')

    const units = extractVirtualUnits(
      {
        filePath: '/tmp/filename-meta.mdx',
        text: source,
        lineStarts: buildLineStarts(source),
      },
      {
        languageMapper: {
          javascript: 'js',
        },
      },
    )

    const fenced = units.find(unit => unit.kind === 'fenced-code')
    expect(fenced?.virtualFilePath).toBe('my_test_file.js')
  })

  it('uses upstream-style default code-block filename indexing', async () => {
    const source = [
      '```js',
      'const a = 1',
      '```',
      '',
      '```ts',
      'const b: number = 2',
      '```',
      '',
    ].join('\n')

    const units = extractVirtualUnits(
      {
        filePath: '/tmp/indexed-filenames.mdx',
        text: source,
        lineStarts: buildLineStarts(source),
      },
      {
        languageMapper: {
          javascript: 'js',
          typescript: 'ts',
        },
      },
    ).filter(unit => unit.kind === 'fenced-code')

    expect(units.map(unit => unit.virtualFilePath)).toEqual(['0.js', '1.ts'])
  })

  it('handles jsx-in-list.mdx without parser/extraction errors', async () => {
    const fixture = await readFixture('jsx-in-list.mdx')
    const units = extractVirtualUnits(
      {
        filePath: fixture.filePath,
        text: fixture.text,
        lineStarts: buildLineStarts(fixture.text),
      },
      {
        languageMapper: {
          javascript: 'js',
        },
      },
    )

    expect(units).toBeDefined()
    expect(Array.isArray(units)).toBe(true)
  })

  it('extracts jsx attribute expression units', async () => {
    const source = '<Card title={post.title} {...props} flag />\n'
    const units = extractVirtualUnits(
      {
        filePath: '/tmp/attrs.mdx',
        text: source,
        lineStarts: buildLineStarts(source),
      },
      {
        languageMapper: {
          javascript: 'js',
        },
      },
    )

    const attrUnits = units.filter((unit) => unit.kind === 'mdx-jsx-attribute-expression')
    expect(attrUnits.length).toBeGreaterThanOrEqual(2)
    expect(attrUnits.some((unit) => unit.sourceText.includes('post.title'))).toBe(true)
    expect(attrUnits.some((unit) => unit.sourceText.includes('...props'))).toBe(true)
  })

  it('honors eslint-skip directives on fenced code blocks', async () => {
    const source = ['{/* eslint-skip */}', '```js', 'var skipped = true', '```', ''].join('\n')

    const units = extractVirtualUnits(
      {
        filePath: '/tmp/skip.mdx',
        text: source,
        lineStarts: buildLineStarts(source),
      },
      {
        languageMapper: {
          javascript: 'js',
        },
      },
    )

    const fenced = units.find((unit) => unit.kind === 'fenced-code')
    expect(fenced?.skip).toBe(true)
  })
})
