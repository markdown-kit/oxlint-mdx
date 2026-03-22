import fs from 'node:fs/promises'
import path from 'node:path'

import type { CliOptions, OxlintMdxConfig } from '../types.js'

const DEFAULT_LANGUAGE_MAPPER: Record<string, string> = {
  ecmascript: 'js',
  javascript: 'js',
  javascriptreact: 'jsx',
  typescript: 'ts',
  typescriptreact: 'tsx',
  markdown: 'md',
  markdownjsx: 'mdx',
  markdownreact: 'mdx',
}

const DEFAULT_CONFIG: OxlintMdxConfig = {
  include: ['**/*.{md,mdx}'],
  ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  languageMapper: DEFAULT_LANGUAGE_MAPPER,
  lintableLanguages: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'],
  remark: {
    enabled: true,
    cwd: process.cwd(),
    applyDefaultLintRules: true,
    applyDefaultLinkValidation: true,
    applyFixes: false,
  },
  oxlint: {
    extraArgs: [],
  },
}

async function maybeReadConfig(configPath: string): Promise<Partial<OxlintMdxConfig> | null> {
  let source: string
  try {
    source = await fs.readFile(configPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
  return JSON.parse(source) as Partial<OxlintMdxConfig>
}

function mergeConfig(
  base: OxlintMdxConfig,
  user: Partial<OxlintMdxConfig> | null,
  cli: CliOptions,
): OxlintMdxConfig {
  const merged: OxlintMdxConfig = {
    include: cli.include.length > 0 ? cli.include : (user?.include ?? base.include),
    ignore: user?.ignore ?? base.ignore,
    languageMapper: user?.languageMapper ?? base.languageMapper,
    lintableLanguages: user?.lintableLanguages ?? base.lintableLanguages,
    remark: {
      ...base.remark,
      ...user?.remark,
      enabled: cli.noRemark ? false : (user?.remark?.enabled ?? base.remark.enabled),
      cwd: cli.cwd,
      configPath: cli.remarkConfigPath ?? user?.remark?.configPath,
      applyFixes: cli.fix,
    },
    oxlint: {
      ...base.oxlint,
      ...user?.oxlint,
      configPath: cli.oxlintConfigPath ?? user?.oxlint?.configPath,
      extraArgs: [...(user?.oxlint?.extraArgs ?? base.oxlint.extraArgs), ...cli.oxlintArgs],
    },
  }

  return merged
}

export async function resolveConfig(cli: CliOptions): Promise<OxlintMdxConfig> {
  const discoveredPath = cli.configPath
    ? path.resolve(cli.cwd, cli.configPath)
    : path.resolve(cli.cwd, '.oxlint-mdxrc.json')

  const userConfig = await maybeReadConfig(discoveredPath)
  return mergeConfig(DEFAULT_CONFIG, userConfig, cli)
}

export function mapLanguage(language: string, mapper: Record<string, string> | false): string {
  if (mapper === false) {
    return language
  }

  const normalized = language.toLowerCase()
  return mapper[language] ?? mapper[normalized] ?? normalized
}
