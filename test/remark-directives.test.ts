import { describe, expect, it } from 'vitest'

import { filterDiagnosticsWithMdxRemarkDirectives } from '../src/remark/directives.js'
import type { RemarkDiagnostic } from '../src/types.js'

function diag(line: number): RemarkDiagnostic {
  return {
    filePath: '/tmp/test.mdx',
    ruleId: 'no-duplicate-headings',
    source: 'remark-lint',
    message: 'Duplicate heading',
    severity: 'warning',
    line,
    column: 1,
  }
}

describe('filterDiagnosticsWithMdxRemarkDirectives', () => {
  it('filters block-disabled ranges', () => {
    const text = [
      '{/* eslint-disable mdx/remark */}',
      '# heading',
      '# heading',
      '{/* eslint-enable mdx/remark */}',
      '# heading',
      '',
    ].join('\n')

    const output = filterDiagnosticsWithMdxRemarkDirectives(text, [diag(2), diag(3), diag(5)])
    expect(output.map((item) => item.line)).toEqual([5])
  })

  it('filters disable-line and disable-next-line directives', () => {
    const text = [
      '# a {/* eslint-disable-line mdx/remark */}',
      '# b',
      '{/* eslint-disable-next-line mdx/remark */}',
      '# c',
      '# d',
      '',
    ].join('\n')

    const output = filterDiagnosticsWithMdxRemarkDirectives(text, [
      diag(1),
      diag(2),
      diag(4),
      diag(5),
    ])
    expect(output.map((item) => item.line)).toEqual([2, 5])
  })
})
