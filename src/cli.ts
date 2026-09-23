#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

import fg from 'fast-glob'

import { resolveConfig } from './config/load.js'
import { extractVirtualUnits } from './extract/markdown.js'
import { resolveMappedOffset } from './mapping/range-map.js'
import { remapDiagnostic, shouldIncludeOxlintDiagnostic } from './mapping/remap-diagnostics.js'
import { applyEdits, buildFixEdit } from './mapping/remap-fixes.js'
import { filterDiagnosticsWithMdxRemarkDirectives } from './remark/directives.js'
import { formatJson, formatStylish } from './report/format.js'
import { runOxlintOnUnits } from './runner/oxlint.js'
import { runRemarkBridge } from './runner/remark.js'
import type {
  CliOptions,
  MappedDiagnostic,
  SourceDocument,
  TextEdit,
  VirtualUnit,
} from './types.js'
import { buildLineStarts, offsetToPosition, positionToOffset } from './utils/lines.js'
import { getStructuredErrorInfo } from './validation.js'

function createParseDiagnostic(document: SourceDocument, error: unknown): MappedDiagnostic {
  const details = getStructuredErrorInfo(error)
  const line = typeof details.line === 'number' && details.line > 0 ? details.line : 1
  const column = typeof details.column === 'number' && details.column > 0 ? details.column : 1

  return {
    filePath: document.filePath,
    code: 'mdx/parse-error',
    severity: 'error',
    message: details.reason ?? details.message ?? 'Failed to parse markdown/MDX document',
    range: {
      start: { line, column, offset: 0 },
      end: { line, column, offset: 0 },
    },
  }
}

function isLintableLanguage(language: string, lintableLanguages: string[]): boolean {
  return lintableLanguages.includes(language.toLowerCase())
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    cwd: process.cwd(),
    include: [],
    oxlintArgs: [],
    fix: false,
    fixSuggestions: false,
    fixDangerously: false,
    outputFormat: 'stylish',
    quiet: false,
    noRemark: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      options.oxlintArgs.push(...argv.slice(index + 1))
      break
    }

    if (arg === '--fix') {
      options.fix = true
      continue
    }

    if (arg === '--fix-suggestions') {
      options.fixSuggestions = true
      continue
    }

    if (arg === '--fix-dangerously') {
      options.fixDangerously = true
      continue
    }

    if (arg === '--quiet') {
      options.quiet = true
      continue
    }

    if (arg === '--no-remark') {
      options.noRemark = true
      continue
    }

    if (arg === '--format' || arg === '-f') {
      const next = argv[index + 1]
      if (next === 'stylish' || next === 'json') {
        options.outputFormat = next
        index += 1
      }
      continue
    }

    if (arg === '--config') {
      options.configPath = argv[index + 1]
      index += 1
      continue
    }

    if (arg === '--oxlint-config') {
      options.oxlintConfigPath = argv[index + 1]
      index += 1
      continue
    }

    if (arg === '--remark-config') {
      options.remarkConfigPath = argv[index + 1]
      index += 1
      continue
    }

    if (arg === '--cwd') {
      options.cwd = path.resolve(argv[index + 1])
      index += 1
      continue
    }

    if (arg.startsWith('-')) {
      options.oxlintArgs.push(arg)
      continue
    }

    if (!arg.startsWith('-')) {
      options.include.push(arg)
    }
  }

  return options
}

async function readDocuments(filePaths: string[]): Promise<SourceDocument[]> {
  const documents: SourceDocument[] = []
  for (const filePath of filePaths) {
    const text = await fs.readFile(filePath, 'utf8')
    documents.push({
      filePath,
      text,
      lineStarts: buildLineStarts(text),
    })
  }
  return documents
}

async function discoverFiles(cwd: string, include: string[], ignore: string[]): Promise<string[]> {
  const patterns = include.length > 0 ? include : ['**/*.{md,mdx}']
  return fg(patterns, {
    cwd,
    ignore,
    absolute: true,
    onlyFiles: true,
    unique: true,
    dot: false,
  })
}

function collectDocumentEdits(
  rewrittenByUnitId: Map<string, string>,
  unitsById: Map<string, ReturnType<typeof extractVirtualUnits>[number]>,
): Map<string, TextEdit[]> {
  const editsByFilePath = new Map<string, TextEdit[]>()

  for (const [unitId, rewrittenText] of rewrittenByUnitId) {
    const unit = unitsById.get(unitId)
    if (!unit) {
      continue
    }

    const edit = buildFixEdit(unit, rewrittenText)
    if (!edit) {
      continue
    }

    const existing = editsByFilePath.get(unit.sourceFilePath)
    if (existing) {
      existing.push(edit)
    } else {
      editsByFilePath.set(unit.sourceFilePath, [edit])
    }
  }

  return editsByFilePath
}

function toMappedFromRemark(
  diagnostic: Awaited<ReturnType<typeof runRemarkBridge>>['diagnostics'][number],
  document: SourceDocument,
): MappedDiagnostic {
  const startOffset = positionToOffset(document.lineStarts, diagnostic.line, diagnostic.column)
  const endOffset =
    diagnostic.endLine != null && diagnostic.endColumn != null
      ? positionToOffset(document.lineStarts, diagnostic.endLine, diagnostic.endColumn)
      : startOffset

  return {
    filePath: diagnostic.filePath,
    code: `${diagnostic.source}/${diagnostic.ruleId}`,
    severity: diagnostic.severity,
    message: diagnostic.message,
    range: {
      start: offsetToPosition(document.lineStarts, startOffset),
      end: offsetToPosition(document.lineStarts, endOffset),
    },
  }
}

function remapEmbeddedRemarkDiagnostic(
  diagnostic: Awaited<ReturnType<typeof runRemarkBridge>>['diagnostics'][number],
  unit: ReturnType<typeof extractVirtualUnits>[number],
  sourceDocument: SourceDocument,
): MappedDiagnostic {
  const unitLineStarts = buildLineStarts(unit.lintText)

  const virtualStartOffset = positionToOffset(unitLineStarts, diagnostic.line, diagnostic.column)
  const virtualEndOffset =
    diagnostic.endLine != null && diagnostic.endColumn != null
      ? positionToOffset(unitLineStarts, diagnostic.endLine, diagnostic.endColumn)
      : virtualStartOffset

  const sourceStartOffset = resolveMappedOffset(
    unit.rangeMap,
    virtualStartOffset,
    unit.sourceStartOffset,
    unit.sourceEndOffset,
  )

  const sourceEndOffset = resolveMappedOffset(
    unit.rangeMap,
    virtualEndOffset,
    unit.sourceStartOffset,
    unit.sourceEndOffset,
  )

  return {
    filePath: unit.sourceFilePath,
    code: `${diagnostic.source}/${diagnostic.ruleId}`,
    severity: diagnostic.severity,
    message: diagnostic.message,
    range: {
      start: offsetToPosition(sourceDocument.lineStarts, sourceStartOffset),
      end: offsetToPosition(sourceDocument.lineStarts, sourceEndOffset),
    },
  }
}

function embeddedRemarkFilePath(unit: VirtualUnit): string {
  const sourceDir = path.dirname(unit.sourceFilePath)
  const sourceStem = path.basename(unit.sourceFilePath, path.extname(unit.sourceFilePath))
  const extension = unit.language === 'mdx' ? '.mdx' : '.md'

  return path.join(sourceDir, `${sourceStem}.${unit.id}${extension}`)
}

async function main(): Promise<number> {
  const cliOptions = parseArgs(process.argv.slice(2))
  const config = await resolveConfig(cliOptions)
  const files = await discoverFiles(cliOptions.cwd, config.include, config.ignore)

  if (files.length === 0) {
    if (cliOptions.outputFormat === 'json') {
      process.stdout.write(formatJson([]))
    } else {
      process.stdout.write('No markdown files matched.\n')
    }
    return 0
  }

  const documents = await readDocuments(files)
  const documentByPath = new Map(documents.map((document) => [document.filePath, document]))

  const mappedDiagnostics: MappedDiagnostic[] = []
  let globalUnitCounter = 0

  const units = documents.flatMap((document) => {
    try {
      return extractVirtualUnits(document, {
        languageMapper: config.languageMapper,
      }).map((unit) => Object.assign(unit, { id: `unit_${globalUnitCounter++}` }))
    } catch (err) {
      mappedDiagnostics.push(createParseDiagnostic(document, err))
      return []
    }
  })

  const runnableUnits = units.filter(
    (unit) => !unit.skip && isLintableLanguage(unit.language, config.lintableLanguages),
  )
  const unitById = new Map(units.map((unit) => [unit.id, unit]))

  const oxlintResult = await runOxlintOnUnits(runnableUnits, {
    cwd: cliOptions.cwd,
    oxlintConfigPath: config.oxlint.configPath,
    extraArgs: config.oxlint.extraArgs,
    fix: cliOptions.fix,
    fixSuggestions: cliOptions.fixSuggestions,
    fixDangerously: cliOptions.fixDangerously,
  })

  for (const diagnostic of oxlintResult.diagnostics) {
    if (!shouldIncludeOxlintDiagnostic(diagnostic)) {
      continue
    }

    const unit = unitById.get(diagnostic.filename)
    if (!unit) {
      continue
    }
    const document = documentByPath.get(unit.sourceFilePath)
    if (!document) {
      continue
    }
    const mapped = remapDiagnostic(diagnostic, unit, document)
    if (mapped) {
      mappedDiagnostics.push(mapped)
    }
  }

  // Track documents whose offsets were invalidated by an oxlint --fix rewrite so
  // we do not remap stale-offset diagnostics against them later in this run.
  const documentsModifiedByFix = new Set<string>()

  if (cliOptions.fix || cliOptions.fixSuggestions || cliOptions.fixDangerously) {
    const editsByFilePath = collectDocumentEdits(oxlintResult.rewrittenUnitTexts, unitById)
    for (const [filePath, edits] of editsByFilePath) {
      const document = documentByPath.get(filePath)
      if (!document) {
        continue
      }
      const nextText = applyEdits(document.text, edits, (dropped) => {
        process.stderr.write(
          `oxlint-mdx: skipped an overlapping autofix in ${filePath} ` +
            `(offsets ${dropped.startOffset}-${dropped.endOffset}); re-run to apply remaining fixes.\n`,
        )
      })
      if (nextText !== document.text) {
        await fs.writeFile(filePath, nextText, 'utf8')
        document.text = nextText
        document.lineStarts = buildLineStarts(nextText)
        documentsModifiedByFix.add(filePath)
      }
    }
  }

  if (config.remark.enabled) {
    const embeddedRemarkUnits = units.filter(
      (unit) => unit.kind === 'fenced-code' && (unit.language === 'md' || unit.language === 'mdx'),
    )

    for (const unit of embeddedRemarkUnits) {
      const sourceDocument = documentByPath.get(unit.sourceFilePath)
      if (!sourceDocument) {
        continue
      }

      // The unit's offsets/rangeMap were computed against the pre-fix document.
      // If an oxlint --fix rewrote that document this run, remapping embedded
      // remark diagnostics would land on stale positions — defer them to the
      // next run (which re-extracts against the fixed source).
      if (documentsModifiedByFix.has(unit.sourceFilePath)) {
        process.stderr.write(
          `oxlint-mdx: deferred embedded remark diagnostics for ${unit.sourceFilePath} ` +
            `(document changed by --fix this run); re-run to see them.\n`,
        )
        continue
      }

      const remarkResult = await runRemarkBridge(
        {
          filePath: embeddedRemarkFilePath(unit),
          text: unit.lintText,
          lineStarts: buildLineStarts(unit.lintText),
        },
        {
          ...config.remark,
          applyFixes: false,
        },
      )

      mappedDiagnostics.push(
        ...filterDiagnosticsWithMdxRemarkDirectives(unit.lintText, remarkResult.diagnostics).map(
          (diagnostic) => remapEmbeddedRemarkDiagnostic(diagnostic, unit, sourceDocument),
        ),
      )
    }

    for (const document of documents) {
      const remarkResult = await runRemarkBridge(document, config.remark)
      const filteredDiagnostics = filterDiagnosticsWithMdxRemarkDirectives(
        document.text,
        remarkResult.diagnostics,
      )

      mappedDiagnostics.push(
        ...filteredDiagnostics.map((diagnostic) => toMappedFromRemark(diagnostic, document)),
      )
    }
  }

  const visibleDiagnostics = cliOptions.quiet
    ? mappedDiagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    : mappedDiagnostics

  if (cliOptions.outputFormat === 'json') {
    process.stdout.write(`${formatJson(visibleDiagnostics)}\n`)
  } else {
    process.stdout.write(`${formatStylish(visibleDiagnostics, cliOptions.cwd)}\n`)
  }

  const errorCount = mappedDiagnostics.filter((item) => item.severity === 'error').length
  return errorCount > 0 ? 1 : 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    process.exitCode = 1
  })
