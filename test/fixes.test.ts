import { describe, expect, it } from 'vitest'

import { extractVirtualUnits } from '../src/extract/markdown.js'
import { resolveMappedOffset } from '../src/mapping/range-map.js'
import { applyEdits, buildFixEdit } from '../src/mapping/remap-fixes.js'
import type { VirtualUnit } from '../src/types.js'
import { buildLineStarts } from '../src/utils/lines.js'

function extractCodeUnit(text: string): VirtualUnit {
  const unit = extractVirtualUnits(
    { filePath: '/tmp/fixture.md', text, lineStarts: buildLineStarts(text) },
    { languageMapper: false },
  ).find((candidate) => candidate.kind === 'fenced-code')
  if (!unit) {
    throw new Error('expected a fenced-code unit')
  }
  return unit
}

function createUnit(overrides: Partial<VirtualUnit>): VirtualUnit {
  return {
    id: 'unit_0',
    kind: 'fenced-code',
    sourceFilePath: '/tmp/file.md',
    virtualFilePath: 'file.md__unit_0.js',
    language: 'js',
    lintText: 'const a = 1\n',
    sourceText: '  const a = 1\n',
    sourceStartOffset: 10,
    sourceEndOffset: 24,
    sourceHasTrailingNewline: true,
    baseIndent: '  ',
    prefixLength: 0,
    suffixLength: 0,
    rangeMap: [{ virtualOffset: 0, sourceOffsetDelta: 10 }],
    skip: false,
    ...overrides,
  }
}

describe('fix remapping', () => {
  it('builds fenced-code replacement edit with indentation', () => {
    const unit = createUnit({})
    const edit = buildFixEdit(unit, 'const a = 2\n')

    expect(edit).not.toBeNull()
    expect(edit?.replacement).toBe('  const a = 2\n')
  })

  it('applies edits from end to start without overlap corruption', () => {
    const source = '0123456789'
    const out = applyEdits(source, [
      { startOffset: 2, endOffset: 4, replacement: 'AA' },
      { startOffset: 6, endOffset: 8, replacement: 'BB' },
    ])

    expect(out).toBe('01AA45BB89')
  })

  it.each([
    ['CRLF fence', '# T\r\n\r\n```js\r\nvar a = 1\r\nvar b = 2\r\n```\r\n'],
    [
      'CRLF fence in a list item',
      '# T\r\n\r\n- item\r\n\r\n  ```js\r\n  var a = 1\r\n  var b = 2\r\n  ```\r\n',
    ],
    ['fence on a bullet list-marker line', '# T\n\n- ```js\n  var a = 1\n  var b = 2\n  ```\n'],
    [
      'fence on an ordered list-marker line',
      '# T\n\n1. ```js\n   var a = 1\n   var b = 2\n   ```\n',
    ],
    [
      'fence on a list-marker line in a blockquote',
      '# T\n\n> - ```js\n>   var a = 1\n>   var b = 2\n>   ```\n',
    ],
    [
      'blockquoted list fence',
      '# T\n\n> - item\n>\n>   ```js\n>   var a = 1\n>   var b = 2\n>   ```\n',
    ],
  ])('writes a code fix back without altering the %s layout', (_name, text) => {
    const unit = extractCodeUnit(text)
    const edit = buildFixEdit(unit, unit.lintText.replaceAll('var', 'const'))

    expect(edit).not.toBeNull()
    expect(applyEdits(text, [edit!])).toBe(text.replaceAll('var', 'const'))
  })

  it('maps diagnostics in a fence opened on a list-marker line to their source column', () => {
    const text = '# T\n\n- ```js\n  var a = 1\n  var b = 2\n  ```\n'
    const unit = extractCodeUnit(text)
    const virtualOffset = unit.lintText.indexOf('b')
    const sourceOffset = resolveMappedOffset(
      unit.rangeMap,
      virtualOffset,
      unit.sourceStartOffset,
      unit.sourceEndOffset,
    )

    expect(sourceOffset).toBe(text.indexOf('b ='))
  })
})
