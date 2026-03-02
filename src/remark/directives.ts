import type { RemarkDiagnostic } from '../types.js'

const REMARK_DIRECTIVE_REGEX =
  /eslint-(disable-next-line|disable-line|disable|enable)\s+mdx\/remark\b/gu

function buildDisabledLines(text: string): Set<number> {
  const lines = text.split('\n')
  const disabledLines = new Set<number>()
  let blockDisabled = false

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const line = lines[index]
    const actions = [...line.matchAll(REMARK_DIRECTIVE_REGEX)].map((match) => match[1])

    for (const action of actions) {
      if (action === 'disable-line') {
        disabledLines.add(lineNumber)
      } else if (action === 'disable-next-line') {
        disabledLines.add(lineNumber + 1)
      } else if (action === 'disable') {
        blockDisabled = true
      } else if (action === 'enable') {
        blockDisabled = false
      }
    }

    if (blockDisabled) {
      disabledLines.add(lineNumber)
    }
  }

  return disabledLines
}

export function filterDiagnosticsWithMdxRemarkDirectives(
  text: string,
  diagnostics: RemarkDiagnostic[],
): RemarkDiagnostic[] {
  if (!text.includes('mdx/remark')) {
    return diagnostics
  }

  const disabledLines = buildDisabledLines(text)
  if (disabledLines.size === 0) {
    return diagnostics
  }

  return diagnostics.filter((diagnostic) => !disabledLines.has(diagnostic.line))
}
