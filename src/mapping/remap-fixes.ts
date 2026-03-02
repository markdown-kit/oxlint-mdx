import type { TextEdit, VirtualUnit } from '../types.js'

function stripWrapper(unit: VirtualUnit, lintText: string): string {
  return lintText.slice(unit.prefixLength, lintText.length - unit.suffixLength)
}

function normalizeFencedReplacement(
  content: string,
  baseIndent: string,
  trailingNewline: boolean,
): string {
  const lines = content.replace(/\n$/u, '').split('\n')
  const indented = lines.map((line) => `${baseIndent}${line}`).join('\n')
  return trailingNewline ? `${indented}\n` : indented
}

export function buildFixEdit(unit: VirtualUnit, rewrittenLintText: string): TextEdit | null {
  if (rewrittenLintText === unit.lintText) {
    return null
  }

  const rewrittenSourceContent = stripWrapper(unit, rewrittenLintText)

  if (unit.kind === 'fenced-code') {
    return {
      startOffset: unit.sourceStartOffset,
      endOffset: unit.sourceEndOffset,
      replacement: normalizeFencedReplacement(
        rewrittenSourceContent,
        unit.baseIndent,
        unit.sourceHasTrailingNewline,
      ),
    }
  }

  return {
    startOffset: unit.sourceStartOffset,
    endOffset: unit.sourceEndOffset,
    replacement: rewrittenSourceContent,
  }
}

export function applyEdits(sourceText: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.startOffset - a.startOffset)

  let output = sourceText
  let lastStart = Number.POSITIVE_INFINITY

  for (const edit of sorted) {
    if (edit.endOffset > lastStart) {
      continue
    }

    output = output.slice(0, edit.startOffset) + edit.replacement + output.slice(edit.endOffset)
    lastStart = edit.startOffset
  }

  return output
}
