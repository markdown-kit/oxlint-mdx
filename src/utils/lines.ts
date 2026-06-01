import type { Position } from '../types.js'

export function buildLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text.codePointAt(i) === 10) {
      starts.push(i + 1)
    }
  }
  return starts
}

export function findLineIndex(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1

  while (low <= high) {
    const mid = (low + high) >> 1
    const start = lineStarts[mid]
    const next = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER

    if (offset < start) {
      high = mid - 1
      continue
    }

    if (offset >= next) {
      low = mid + 1
      continue
    }

    return mid
  }

  return Math.max(0, Math.min(lineStarts.length - 1, low))
}

export function offsetToPosition(lineStarts: number[], offset: number): Position {
  const lineIndex = findLineIndex(lineStarts, offset)
  const lineStart = lineStarts[lineIndex]
  return {
    line: lineIndex + 1,
    column: offset - lineStart + 1,
    offset,
  }
}

export function positionToOffset(lineStarts: number[], line: number, column: number): number {
  const safeLine = Math.max(1, Math.min(lineStarts.length, line))
  const lineStart = lineStarts[safeLine - 1]
  return lineStart + Math.max(0, column - 1)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Convert a UTF-8 byte offset into a UTF-16 (JavaScript string) offset within
 * `text`.
 *
 * Oxlint (oxc, Rust) reports diagnostic spans as UTF-8 byte offsets/lengths,
 * whereas the extraction range map and line-start tables are built in JS string
 * units. Feeding byte offsets straight into the UTF-16 machinery shifts every
 * position after a multi-byte character (accents, emoji, CJK). This bridges the
 * two coordinate systems. Offsets that fall on a code-point boundary (the case
 * for real token spans) map exactly; an offset that lands mid–code-point maps to
 * the start of the enclosing code point.
 */
export function byteOffsetToCharOffset(text: string, byteOffset: number): number {
  if (byteOffset <= 0) {
    return 0
  }

  let bytes = 0
  let chars = 0
  for (const codePoint of text) {
    if (bytes >= byteOffset) {
      break
    }
    bytes += Buffer.byteLength(codePoint, 'utf8')
    chars += codePoint.length
  }
  return chars
}

export function getLineStartOffset(text: string, offset: number): number {
  const index = text.lastIndexOf('\n', Math.max(0, offset - 1))
  return index === -1 ? 0 : index + 1
}
