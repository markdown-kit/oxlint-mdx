import { describe, expect, it } from 'vitest'

import { extractVirtualUnits } from '../src/extract/markdown.js'
import { buildLineStarts } from '../src/utils/lines.js'

describe('extractVirtualUnits', () => {
  it('extracts fenced code blocks with mapped metadata', () => {
    const text = [
      '- item',
      '  ```js',
      '  const value = 1',
      '  console.log(value)',
      '  ```',
      '',
    ].join('\n')

    const units = extractVirtualUnits(
      {
        filePath: '/tmp/example.mdx',
        text,
        lineStarts: buildLineStarts(text),
      },
      {
        languageMapper: {
          javascript: 'js',
        },
      },
    )

    const codeUnit = units.find((unit) => unit.kind === 'fenced-code')

    expect(codeUnit).toBeDefined()
    expect(codeUnit?.language).toBe('js')
    expect(codeUnit?.lintText).toContain('const value = 1')
    expect(codeUnit?.rangeMap.length).toBeGreaterThan(0)
  })

  it('uses mapped language extensions for default fenced-code virtual filenames', () => {
    const text = ['```typescript', 'const value: number = 1', '```', ''].join('\n')

    const units = extractVirtualUnits(
      {
        filePath: '/tmp/example.md',
        text,
        lineStarts: buildLineStarts(text),
      },
      {
        languageMapper: {
          typescript: 'ts',
        },
      },
    )

    const codeUnit = units.find((unit) => unit.kind === 'fenced-code')

    expect(codeUnit?.language).toBe('ts')
    expect(codeUnit?.virtualFilePath).toBe('0.ts')
  })

  it('extracts mdx expressions and esm nodes', () => {
    const text = ['export const answer = 42', '', '# Title {answer}', '', '{answer + 1}', ''].join(
      '\n',
    )

    const units = extractVirtualUnits(
      {
        filePath: '/tmp/expressions.mdx',
        text,
        lineStarts: buildLineStarts(text),
      },
      {
        languageMapper: {
          javascript: 'js',
        },
      },
    )

    expect(units.some((unit) => unit.kind === 'mdx-esm')).toBe(true)
    expect(
      units.some(
        (unit) => unit.kind === 'mdx-flow-expression' || unit.kind === 'mdx-text-expression',
      ),
    ).toBe(true)
  })
})
