export type UnitKind =
  | 'fenced-code'
  | 'mdx-flow-expression'
  | 'mdx-text-expression'
  | 'mdx-jsx-attribute-expression'
  | 'mdx-jsx-element'
  | 'mdx-esm'

export interface Position {
  line: number
  column: number
  offset: number
}

export interface Range {
  start: Position
  end: Position
}

export interface SourceDocument {
  filePath: string
  text: string
  lineStarts: number[]
}

export interface RangeMapEntry {
  virtualOffset: number
  sourceOffsetDelta: number
}

export interface VirtualUnit {
  id: string
  kind: UnitKind
  sourceFilePath: string
  virtualFilePath: string
  language: string
  lintText: string
  sourceText: string
  sourceStartOffset: number
  sourceEndOffset: number
  sourceHasTrailingNewline: boolean
  baseIndent: string
  prefixLength: number
  suffixLength: number
  rangeMap: RangeMapEntry[]
  skip: boolean
}

export interface MappedDiagnostic {
  filePath: string
  code: string
  severity: 'error' | 'warning'
  message: string
  help?: string
  url?: string
  range: Range
}

export interface TextEdit {
  startOffset: number
  endOffset: number
  replacement: string
}

export interface OxlintRawSpan {
  offset: number
  length: number
  line: number
  column: number
}

export interface OxlintRawDiagnostic {
  message: string
  code: string
  severity: 'error' | 'warning'
  help?: string
  url?: string
  filename: string
  labels: Array<{ span: OxlintRawSpan }>
}

export interface OxlintJsonOutput {
  diagnostics: OxlintRawDiagnostic[]
}

export interface RemarkDiagnostic {
  filePath: string
  ruleId: string
  source: string
  message: string
  severity: 'error' | 'warning'
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

export interface FixMode {
  fix: boolean
  fixSuggestions: boolean
  fixDangerously: boolean
}

export interface OxlintRunnerOptions extends FixMode {
  cwd: string
  oxlintConfigPath?: string
  extraArgs: string[]
}

export interface OxlintRunnerResult {
  diagnostics: OxlintRawDiagnostic[]
  rewrittenUnitTexts: Map<string, string>
}

export interface RemarkBridgeOptions {
  enabled: boolean
  cwd: string
  configPath?: string
  ignoreConfig?: boolean
  applyDefaultLintRules?: boolean
  applyDefaultLinkValidation?: boolean
  applyFixes: boolean
}

export interface RemarkBridgeResult {
  diagnostics: RemarkDiagnostic[]
  fixedText?: string
}

export interface OxlintMdxConfig {
  include: string[]
  ignore: string[]
  languageMapper: Record<string, string> | false
  lintableLanguages: string[]
  remark: RemarkBridgeOptions
  oxlint: {
    configPath?: string
    extraArgs: string[]
  }
}

export interface CliOptions extends FixMode {
  cwd: string
  include: string[]
  oxlintArgs: string[]
  configPath?: string
  oxlintConfigPath?: string
  remarkConfigPath?: string
  outputFormat: 'stylish' | 'json'
  quiet: boolean
  noRemark: boolean
}
