import type {
  OxlintJsonOutput,
  OxlintMdxUserConfig,
  OxlintRawDiagnostic,
  OxlintRawSpan,
} from './types.js'

type JsonObject = Record<string, unknown>

interface StructuredErrorInfo {
  message: string
  reason?: string
  line?: number
  column?: number
}

const CONFIG_KEYS = new Set([
  'include',
  'ignore',
  'languageMapper',
  'lintableLanguages',
  'remark',
  'oxlint',
])

const REMARK_CONFIG_KEYS = new Set([
  'enabled',
  'configPath',
  'ignoreConfig',
  'applyDefaultLintRules',
  'applyDefaultLinkValidation',
])

const OXLINT_CONFIG_KEYS = new Set(['configPath', 'extraArgs'])

function isObjectRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectObjectRecord(value: unknown, context: string): JsonObject {
  if (!isObjectRecord(value)) {
    throw new TypeError(`${context} must be a JSON object`)
  }

  return value
}

function validateKnownKeys(value: JsonObject, allowedKeys: Set<string>, context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${context}.${key} is not a supported property`)
    }
  }
}

function readOptionalString(value: unknown, context: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new TypeError(`${context} must be a string`)
  }

  return value
}

function readOptionalBoolean(value: unknown, context: string): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new TypeError(`${context} must be a boolean`)
  }

  return value
}

function readOptionalStringArray(value: unknown, context: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${context} must be an array of strings`)
  }

  return [...value]
}

function readLanguageMapper(
  value: unknown,
  context: string,
): OxlintMdxUserConfig['languageMapper'] {
  if (value === undefined || value === false) {
    return value
  }

  const record = expectObjectRecord(value, context)
  const mapper: Record<string, string> = {}

  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== 'string') {
      throw new TypeError(`${context}.${key} must be a string`)
    }

    mapper[key] = entryValue
  }

  return mapper
}

function readRemarkConfig(value: unknown, context: string): OxlintMdxUserConfig['remark'] {
  if (value === undefined) {
    return undefined
  }

  const record = expectObjectRecord(value, context)
  validateKnownKeys(record, REMARK_CONFIG_KEYS, context)

  return {
    enabled: readOptionalBoolean(record.enabled, `${context}.enabled`),
    configPath: readOptionalString(record.configPath, `${context}.configPath`),
    ignoreConfig: readOptionalBoolean(record.ignoreConfig, `${context}.ignoreConfig`),
    applyDefaultLintRules: readOptionalBoolean(
      record.applyDefaultLintRules,
      `${context}.applyDefaultLintRules`,
    ),
    applyDefaultLinkValidation: readOptionalBoolean(
      record.applyDefaultLinkValidation,
      `${context}.applyDefaultLinkValidation`,
    ),
  }
}

function readOxlintConfig(value: unknown, context: string): OxlintMdxUserConfig['oxlint'] {
  if (value === undefined) {
    return undefined
  }

  const record = expectObjectRecord(value, context)
  validateKnownKeys(record, OXLINT_CONFIG_KEYS, context)

  return {
    configPath: readOptionalString(record.configPath, `${context}.configPath`),
    extraArgs: readOptionalStringArray(record.extraArgs, `${context}.extraArgs`),
  }
}

function parseOxlintSpan(value: unknown, context: string): OxlintRawSpan {
  const record = expectObjectRecord(value, context)
  const { offset, length, line, column } = record

  if (
    typeof offset !== 'number' ||
    typeof length !== 'number' ||
    typeof line !== 'number' ||
    typeof column !== 'number'
  ) {
    throw new TypeError(`${context} must contain numeric offset, length, line, and column fields`)
  }

  return {
    offset,
    length,
    line,
    column,
  }
}

function parseOxlintDiagnostic(value: unknown, context: string): OxlintRawDiagnostic {
  const record = expectObjectRecord(value, context)

  if (typeof record.message !== 'string') {
    throw new TypeError(`${context}.message must be a string`)
  }

  if (typeof record.code !== 'string') {
    throw new TypeError(`${context}.code must be a string`)
  }

  if (record.severity !== 'error' && record.severity !== 'warning') {
    throw new TypeError(`${context}.severity must be "error" or "warning"`)
  }

  if (typeof record.filename !== 'string') {
    throw new TypeError(`${context}.filename must be a string`)
  }

  if (!Array.isArray(record.labels)) {
    throw new TypeError(`${context}.labels must be an array`)
  }

  const labels = record.labels.map((label, index) => {
    const labelRecord = expectObjectRecord(label, `${context}.labels[${index}]`)
    return {
      span: parseOxlintSpan(labelRecord.span, `${context}.labels[${index}].span`),
    }
  })

  const help = readOptionalString(record.help, `${context}.help`)
  const url = readOptionalString(record.url, `${context}.url`)

  return {
    message: record.message,
    code: record.code,
    severity: record.severity,
    ...(help ? { help } : {}),
    ...(url ? { url } : {}),
    filename: record.filename,
    labels,
  }
}

export function getStructuredErrorInfo(error: unknown): StructuredErrorInfo {
  if (!isObjectRecord(error)) {
    if (error instanceof Error) {
      return { message: error.message }
    }

    return { message: String(error) }
  }

  const reason = typeof error.reason === 'string' ? error.reason : undefined
  const message =
    reason ??
    (typeof error.message === 'string'
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Unknown error')

  return {
    message,
    reason,
    line: typeof error.line === 'number' ? error.line : undefined,
    column: typeof error.column === 'number' ? error.column : undefined,
  }
}

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return isObjectRecord(error) && typeof error.code === 'string'
}

export function parseOxlintMdxUserConfig(source: string, sourceName: string): OxlintMdxUserConfig {
  let parsed: unknown

  try {
    parsed = JSON.parse(source)
  } catch (err) {
    const details = getStructuredErrorInfo(err)
    throw new TypeError(`Invalid JSON in ${sourceName}: ${details.message}`)
  }

  const record = expectObjectRecord(parsed, sourceName)
  validateKnownKeys(record, CONFIG_KEYS, sourceName)

  return {
    include: readOptionalStringArray(record.include, `${sourceName}.include`),
    ignore: readOptionalStringArray(record.ignore, `${sourceName}.ignore`),
    languageMapper: readLanguageMapper(record.languageMapper, `${sourceName}.languageMapper`),
    lintableLanguages: readOptionalStringArray(
      record.lintableLanguages,
      `${sourceName}.lintableLanguages`,
    ),
    remark: readRemarkConfig(record.remark, `${sourceName}.remark`),
    oxlint: readOxlintConfig(record.oxlint, `${sourceName}.oxlint`),
  }
}

export function parseOxlintJsonOutput(stdout: string): OxlintJsonOutput {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return { diagnostics: [] }
  }

  if (/^No files found\b/u.test(trimmed)) {
    return { diagnostics: [] }
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    const details = getStructuredErrorInfo(err)
    throw new TypeError(`Invalid Oxlint JSON output: ${details.message}`)
  }

  const record = expectObjectRecord(parsed, 'Oxlint JSON output')
  if (!Array.isArray(record.diagnostics)) {
    throw new TypeError('Oxlint JSON output must contain a diagnostics array')
  }

  return {
    diagnostics: record.diagnostics.map((diagnostic, index) =>
      parseOxlintDiagnostic(diagnostic, `Oxlint JSON output.diagnostics[${index}]`),
    ),
  }
}
