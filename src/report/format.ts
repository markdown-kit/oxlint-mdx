import path from 'node:path'

import type { MappedDiagnostic } from '../types.js'

function sortDiagnostics(diagnostics: MappedDiagnostic[]): MappedDiagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const file = a.filePath.localeCompare(b.filePath)
    if (file !== 0) {
      return file
    }
    const line = a.range.start.line - b.range.start.line
    if (line !== 0) {
      return line
    }
    return a.range.start.column - b.range.start.column
  })
}

export function formatStylish(diagnostics: MappedDiagnostic[], cwd: string): string {
  const sorted = sortDiagnostics(diagnostics)
  if (sorted.length === 0) {
    return '✓ No lint issues found.'
  }

  const lines: string[] = []
  for (const diagnostic of sorted) {
    const relativePath = path.relative(cwd, diagnostic.filePath) || diagnostic.filePath
    lines.push(
      `${relativePath}:${diagnostic.range.start.line}:${diagnostic.range.start.column}  ${diagnostic.severity}  ${diagnostic.code}  ${diagnostic.message}`,
    )
  }

  const errorCount = sorted.filter((item) => item.severity === 'error').length
  const warningCount = sorted.filter((item) => item.severity === 'warning').length
  lines.push('')
  lines.push(`✖ ${sorted.length} problems (${errorCount} errors, ${warningCount} warnings)`)
  return lines.join('\n')
}

export function formatJson(diagnostics: MappedDiagnostic[]): string {
  return JSON.stringify(
    {
      diagnostics,
      summary: {
        total: diagnostics.length,
        errors: diagnostics.filter((item) => item.severity === 'error').length,
        warnings: diagnostics.filter((item) => item.severity === 'warning').length,
      },
    },
    null,
    2,
  )
}
