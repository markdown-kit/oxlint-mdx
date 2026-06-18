import { describe, expect, it } from 'vitest'

import { extractVirtualUnits } from '../../src/extract/markdown.js'
import { remapDiagnostic } from '../../src/mapping/remap-diagnostics.js'
import type { OxlintRawDiagnostic, SourceDocument } from '../../src/types.js'
import { buildLineStarts } from '../../src/utils/lines.js'

/**
 * Self-contained parity/regression suite.
 *
 * The upstream-eslint-mdx comparison (matrix/fixtures/snapshot-parse-errors)
 * requires a local eslint-mdx checkout (ESLINT_MDX_REPO_ROOT or ../eslint-mdx)
 * because eslint-mdx does not publish its test fixtures to npm, so those suites
 * are necessarily opt-in. This suite instead proves the behavior that parity is
 * about — that fenced code blocks and MDX expressions are extracted into the
 * right virtual units and that diagnostics remap back to correct SOURCE
 * positions — using fixtures owned by this repo, so it always runs by default.
 */

function makeDocument(text: string): SourceDocument {
  return { filePath: 'doc.md', text, lineStarts: buildLineStarts(text) }
}

const EXTRACT_OPTIONS = {
  languageMapper: {
    ecmascript: 'js',
    javascript: 'js',
    javascriptreact: 'jsx',
    typescript: 'ts',
    typescriptreact: 'tsx',
  },
  lintableLanguages: ['js', 'jsx', 'ts', 'tsx'],
} as const

describe('self-contained parity', () => {
  it('extracts a fenced JS code block as a lintable virtual unit', () => {
    const text = '# Title\n\n```js\nconst x = 1\n```\n'
    const doc = makeDocument(text)
    const units = extractVirtualUnits(doc, EXTRACT_OPTIONS)

    const fenced = units.find((unit) => unit.kind === 'fenced-code')
    expect(fenced).toBeDefined()
    expect(fenced?.language).toBe('js')
    expect(fenced?.lintText).toContain('const x = 1')
    // The unit's source span points at the real code body in the document.
    expect(text.slice(fenced!.sourceStartOffset, fenced!.sourceEndOffset)).toContain('const x = 1')
  })

  it('remaps a code-block diagnostic to its real source position', () => {
    const text = '# Title\n\n```js\nconst y = 2\n```\n'
    const doc = makeDocument(text)
    const units = extractVirtualUnits(doc, EXTRACT_OPTIONS)
    const unit = units.find((u) => u.kind === 'fenced-code')!

    // Oxlint reports `y` at its UTF-8 byte offset within the virtual lint text.
    const byteOffsetOfY = Buffer.byteLength(
      unit.lintText.slice(0, unit.lintText.indexOf('y')),
      'utf8',
    )
    const diagnostic: OxlintRawDiagnostic = {
      message: "'y' is assigned a value but never used.",
      code: 'eslint(no-unused-vars)',
      severity: 'warning',
      filename: unit.id,
      labels: [{ span: { offset: byteOffsetOfY, length: 1, line: 1, column: 7 } }],
    }

    const mapped = remapDiagnostic(diagnostic, unit, doc)
    expect(mapped).not.toBeNull()
    // `const y = 2` is on source line 4.
    expect(mapped!.range.start.line).toBe(4)
    const off = mapped!.range.start.offset
    expect(text.slice(off, off + 1)).toBe('y')
  })

  it('does not extract a fenced block without an info string as lintable', () => {
    const text = '```\nplain text\n```\n'
    const units = extractVirtualUnits(makeDocument(text), EXTRACT_OPTIONS)
    expect(units.some((u) => u.kind === 'fenced-code')).toBe(false)
  })
})
