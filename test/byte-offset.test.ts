import { describe, expect, it } from 'vitest'

import { remapDiagnostic } from '../src/mapping/remap-diagnostics.js'
import type { OxlintRawDiagnostic, SourceDocument, VirtualUnit } from '../src/types.js'
import { buildLineStarts, byteOffsetToCharOffset } from '../src/utils/lines.js'

describe('byteOffsetToCharOffset', () => {
  it('returns identical offsets for pure ASCII', () => {
    const text = 'const x = 1'
    expect(byteOffsetToCharOffset(text, 6)).toBe(6)
    expect(byteOffsetToCharOffset(text, 0)).toBe(0)
  })

  it('accounts for multi-byte characters before the offset', () => {
    // "café" — é is 2 bytes in UTF-8 but 1 UTF-16 unit.
    const text = 'const café = 1'
    // byte offset of the space after "café": "const " (6) + "café" (5 bytes) = 11
    expect(byteOffsetToCharOffset(text, 11)).toBe(10) // 6 + 4 chars
  })

  it('handles astral (4-byte / surrogate-pair) characters', () => {
    // 😀 is 4 UTF-8 bytes and 2 UTF-16 code units.
    const text = '😀x'
    expect(byteOffsetToCharOffset(text, 4)).toBe(2) // after the emoji
  })
})

describe('remapDiagnostic with non-ASCII', () => {
  it('places the diagnostic on the correct source column after a multi-byte char', () => {
    // Source document with an accented identifier inside a fenced code block.
    const sourceText = '# Doc\n\n```js\nconst café = 1\nvar unused = 2\n```\n'
    const sourceDocument: SourceDocument = {
      filePath: 'doc.md',
      text: sourceText,
      lineStarts: buildLineStarts(sourceText),
    }

    // The virtual unit is the code-block contents; here it maps 1:1 to source
    // offsets (delta to the start of the code body at offset 13).
    const lintText = 'const café = 1\nvar unused = 2\n'
    const codeBodyStart = sourceText.indexOf('const café')
    const unit: VirtualUnit = {
      id: 'u1',
      kind: 'fenced-code',
      sourceFilePath: 'doc.md',
      virtualFilePath: 'u1.js',
      language: 'js',
      lintText,
      sourceText: lintText,
      sourceStartOffset: codeBodyStart,
      sourceEndOffset: codeBodyStart + lintText.length,
      sourceHasTrailingNewline: true,
      baseIndent: '',
      prefixLength: 0,
      suffixLength: 0,
      rangeMap: [{ virtualOffset: 0, sourceOffsetDelta: codeBodyStart }],
      skip: false,
    }

    // Oxlint reports `unused` using a UTF-8 BYTE offset. "const café = 1\n" is
    // 16 bytes (café = 5 bytes) but 15 UTF-16 units; "var " adds 4 => byte 20.
    const byteOffsetOfUnused = Buffer.byteLength('const café = 1\nvar ', 'utf8')
    const diagnostic: OxlintRawDiagnostic = {
      message: "'unused' is assigned a value but never used.",
      code: 'eslint(no-unused-vars)',
      severity: 'warning',
      filename: 'u1',
      labels: [{ span: { offset: byteOffsetOfUnused, length: 6, line: 2, column: 5 } }],
    }

    const mapped = remapDiagnostic(diagnostic, unit, sourceDocument)
    // The source line of `var unused` is line 5; column of `unused` is 5.
    expect(mapped.range.start.line).toBe(5)
    expect(mapped.range.start.column).toBe(5)
    // And the highlighted text is exactly `unused`.
    const startOffset = mapped.range.start.offset
    expect(sourceText.slice(startOffset, startOffset + 6)).toBe('unused')
  })
})
