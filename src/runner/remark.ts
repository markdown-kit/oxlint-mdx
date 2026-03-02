import path from 'node:path'
import { promisify } from 'node:util'

import remarkLintFencedCodeFlag from 'remark-lint-fenced-code-flag'
import remarkLintNoDuplicateHeadingsInSection from 'remark-lint-no-duplicate-headings-in-section'
import remarkLintNoMultipleToplevelHeadings from 'remark-lint-no-multiple-toplevel-headings'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import remarkValidateLinks from 'remark-validate-links'
import { unified } from 'unified'
import { Configuration } from 'unified-engine'
import { VFile } from 'vfile'

import type {
  RemarkBridgeOptions,
  RemarkBridgeResult,
  RemarkDiagnostic,
  SourceDocument,
} from '../types.js'

interface LoadedRemarkConfig {
  plugins: Array<[unknown, unknown?]>
  settings?: Record<string, unknown>
}

const configLoadCache = new Map<string, (filePath: string) => Promise<LoadedRemarkConfig>>()

function getConfigLoader(cwd: string, configPath?: string) {
  const cacheKey = `${cwd}\0${configPath ?? ''}`
  const existing = configLoadCache.get(cacheKey)
  if (existing) {
    return existing
  }

  const configuration = new Configuration({
    cwd,
    packageField: 'remarkConfig',
    pluginPrefix: 'remark',
    rcName: '.remarkrc',
    rcPath: configPath,
    detectConfig: true,
  })

  const loader = promisify(configuration.load.bind(configuration)) as (
    filePath: string,
  ) => Promise<LoadedRemarkConfig>
  configLoadCache.set(cacheKey, loader)
  return loader
}

function normalizeSeverity(fatal: boolean | null | undefined): 'error' | 'warning' {
  if (fatal === true) {
    return 'error'
  }
  return 'warning'
}

function normalizeDiagnostic(
  filePath: string,
  message: {
    source?: string
    ruleId?: string
    reason: string
    fatal?: boolean | null
    line?: number
    column?: number
    place?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
  },
): RemarkDiagnostic {
  const { place } = message
  const placeRange =
    place != null && typeof place === 'object' && 'start' in place
      ? (place as {
          start?: { line?: number; column?: number }
          end?: { line?: number; column?: number }
        })
      : undefined

  const startLine = placeRange?.start?.line ?? message.line ?? 1
  const startColumn = placeRange?.start?.column ?? message.column ?? 1
  const endLine = placeRange?.end?.line
  const endColumn = placeRange?.end?.column

  return {
    filePath,
    source: message.source ?? 'remark',
    ruleId: message.ruleId ?? 'unknown',
    message: message.reason,
    severity: normalizeSeverity(message.fatal),
    line: startLine,
    column: startColumn,
    endLine,
    endColumn,
  }
}

export async function runRemarkBridge(
  document: SourceDocument,
  options: RemarkBridgeOptions,
): Promise<RemarkBridgeResult> {
  if (!options.enabled) {
    return { diagnostics: [] }
  }

  const ext = path.extname(document.filePath).toLowerCase()
  const isMdx = ext === '.mdx'
  const loader = getConfigLoader(options.cwd, options.ignoreConfig ? undefined : options.configPath)
  const loaded = options.ignoreConfig ? { plugins: [] } : await loader(document.filePath)

  const processor = unified()
    .use(remarkParse)
    .use({ settings: loaded.settings ?? {} })
    .use(remarkStringify)

  if (options.applyDefaultLintRules ?? true) {
    processor
      .use(remarkLintFencedCodeFlag as never)
      .use(remarkLintNoDuplicateHeadingsInSection as never)
      .use(remarkLintNoMultipleToplevelHeadings as never)
  }

  if (options.applyDefaultLinkValidation ?? true) {
    processor.use(remarkValidateLinks as never)
  }

  if (isMdx) {
    processor.use(remarkMdx)
  }

  for (const [plugin, pluginOptions] of loaded.plugins ?? []) {
    if (pluginOptions === undefined) {
      processor.use(plugin as never)
    } else {
      processor.use(plugin as never, pluginOptions as never)
    }
  }

  const file = new VFile({
    path: document.filePath,
    value: document.text,
    cwd: options.cwd,
  })

  try {
    await processor.process(file)
  } catch (caught) {
    const err = caught as { reason?: string; message?: string }
    file.message(err.reason ?? err.message ?? 'Unknown remark processing error').fatal = true
  }

  const diagnostics = file.messages.map((message) =>
    normalizeDiagnostic(document.filePath, {
      source: message.source,
      ruleId: message.ruleId,
      reason: message.reason,
      fatal: message.fatal,
      line: message.line,
      column: message.column,
      place:
        message.place != null && typeof message.place === 'object' && 'start' in message.place
          ? {
              start: {
                line: message.place.start?.line,
                column: message.place.start?.column,
              },
              end: {
                line: message.place.end?.line,
                column: message.place.end?.column,
              },
            }
          : undefined,
    }),
  )

  const rewritten = file.toString()
  return {
    diagnostics,
    fixedText: options.applyFixes && rewritten !== document.text ? rewritten : undefined,
  }
}
