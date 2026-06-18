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

/**
 * Apply text edits right-to-left so earlier offsets stay valid.
 *
 * Overlapping edits cannot both be applied safely; when that happens (e.g. a
 * JSX element unit and one of its attribute-expression sub-units both produce a
 * fix), the conflicting edit is dropped and reported via `onDrop` rather than
 * silently skipped, so callers can surface that a fix could not be applied.
 *
 * @param sourceText - original document text
 * @param edits - edits in source coordinates
 * @param onDrop - optional callback invoked with each edit dropped for overlap
 */
export function applyEdits(
  sourceText: string,
  edits: TextEdit[],
  onDrop?: (edit: TextEdit) => void,
): string {
  const sorted = [...edits].sort((a, b) => b.startOffset - a.startOffset)

  let output = sourceText
  let lastStart = Number.POSITIVE_INFINITY

  for (const edit of sorted) {
    if (edit.endOffset > lastStart) {
      onDrop?.(edit)
      continue
    }

    output = output.slice(0, edit.startOffset) + edit.replacement + output.slice(edit.endOffset)
    lastStart = edit.startOffset
  }

  return output
}
