import path from 'node:path'
import { promisify } from 'node:util'

import { execa } from 'execa'
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
import { getStructuredErrorInfo } from '../validation.js'

interface LoadedRemarkConfig {
  plugins: Array<[unknown, unknown?]>
  settings?: Record<string, unknown>
}

const configLoadCache = new Map<string, (filePath: string) => Promise<LoadedRemarkConfig>>()
const originRemoteCache = new Map<string, Promise<boolean>>()

/**
 * Whether `directory` is inside a Git repository with an `origin` remote.
 *
 * remark-validate-links detects the hosted repository from `origin` when no
 * `repository` option is given and throws if that fails (no Git, no repo, or
 * no `origin`). Callers pass `repository: false` in that case so link
 * validation still runs against the local file system.
 */
function hasOriginRemote(directory: string): Promise<boolean> {
  const existing = originRemoteCache.get(directory)
  if (existing) {
    return existing
  }

  const pending = execa('git', ['remote', 'get-url', 'origin'], {
    cwd: directory,
    reject: false,
  }).then((result) => result.exitCode === 0 && result.stdout.trim() !== '')
  originRemoteCache.set(directory, pending)
  return pending
}

function readPlaceRange(message: {
  place?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
}):
  | { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
  | undefined {
  const { place } = message
  if (place == null || typeof place !== 'object' || !('start' in place || 'end' in place)) {
    return undefined
  }

  return {
    start: {
      line: place.start?.line,
      column: place.start?.column,
    },
    end: {
      line: place.end?.line,
      column: place.end?.column,
    },
  }
}

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

  // SAFETY: unified-engine exposes a callback-based loader, but its public typings
  // do not preserve the resolved config shape through `promisify`.
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
  const placeRange = readPlaceRange(message)

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
      // SAFETY: these plugins expose unified-compatible transformers, but their generic
      // typings are narrower than `processor.use` expects under NodeNext resolution.
      .use(remarkLintFencedCodeFlag as never)
      .use(remarkLintNoDuplicateHeadingsInSection as never)
      .use(remarkLintNoMultipleToplevelHeadings as never)
  }

  if (options.applyDefaultLinkValidation ?? true) {
    const linkOptions = (await hasOriginRemote(path.dirname(path.resolve(document.filePath))))
      ? undefined
      : { repository: false }
    // SAFETY: remark-validate-links is a valid unified plugin with incomplete generic metadata.
    processor.use(remarkValidateLinks as never, linkOptions as never)
  }

  if (isMdx) {
    processor.use(remarkMdx)
  }

  for (const [plugin, pluginOptions] of loaded.plugins ?? []) {
    if (pluginOptions === undefined) {
      // SAFETY: user config plugins are resolved by unified-engine and must be passed through verbatim.
      processor.use(plugin as never)
    } else {
      // SAFETY: user config plugins are resolved by unified-engine and must be passed through verbatim.
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
  } catch (err) {
    const details = getStructuredErrorInfo(err)
    const reason = details.reason ?? details.message ?? 'Unknown remark processing error'
    file.message(reason).fatal = true
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
