import { describe, expect, it } from 'vitest'

import { applyEdits, buildFixEdit } from '../src/mapping/remap-fixes.js'
import type { VirtualUnit } from '../src/types.js'

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
})
