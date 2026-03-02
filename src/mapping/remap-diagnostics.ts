import type {
  MappedDiagnostic,
  OxlintRawDiagnostic,
  SourceDocument,
  VirtualUnit,
} from '../types.js'
import { offsetToPosition } from '../utils/lines.js'
import { resolveMappedOffset } from './range-map.js'

const UNSATISFIABLE_RULE_CODES = new Set(['eslint(eol-last)', 'eslint(unicode-bom)'])

export function shouldIncludeOxlintDiagnostic(diagnostic: OxlintRawDiagnostic): boolean {
  return !UNSATISFIABLE_RULE_CODES.has(diagnostic.code)
}

export function remapDiagnostic(
  diagnostic: OxlintRawDiagnostic,
  unit: VirtualUnit,
  sourceDocument: SourceDocument,
): MappedDiagnostic {
  const span = diagnostic.labels[0]?.span

  const virtualStart = span?.offset ?? unit.prefixLength
  const virtualEnd = span ? span.offset + span.length : virtualStart

  const sourceStartOffset = resolveMappedOffset(
    unit.rangeMap,
    virtualStart,
    unit.sourceStartOffset,
    unit.sourceEndOffset,
  )

  const sourceEndOffset = resolveMappedOffset(
    unit.rangeMap,
    virtualEnd,
    unit.sourceStartOffset,
    unit.sourceEndOffset,
  )

  return {
    filePath: unit.sourceFilePath,
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    help: diagnostic.help,
    url: diagnostic.url,
    range: {
      start: offsetToPosition(sourceDocument.lineStarts, sourceStartOffset),
      end: offsetToPosition(sourceDocument.lineStarts, sourceEndOffset),
    },
  }
}
