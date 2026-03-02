import type { RangeMapEntry } from '../types.js'
import { clamp } from '../utils/lines.js'

export function resolveMappedOffset(
  rangeMap: RangeMapEntry[],
  virtualOffset: number,
  sourceStartOffset: number,
  sourceEndOffset: number,
): number {
  if (rangeMap.length === 0) {
    return clamp(sourceStartOffset, sourceStartOffset, sourceEndOffset)
  }

  let low = 0
  let high = rangeMap.length - 1
  let candidate = rangeMap[0]

  while (low <= high) {
    const mid = (low + high) >> 1
    const entry = rangeMap[mid]

    if (entry.virtualOffset <= virtualOffset) {
      candidate = entry
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  const sourceOffset = virtualOffset + candidate.sourceOffsetDelta
  return clamp(sourceOffset, sourceStartOffset, sourceEndOffset)
}
