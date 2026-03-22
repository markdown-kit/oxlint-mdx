import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { execa, ExecaError } from 'execa'

import type {
  OxlintJsonOutput,
  OxlintRawDiagnostic,
  OxlintRunnerOptions,
  OxlintRunnerResult,
  VirtualUnit,
} from '../types.js'

function normalizeDiagnosticPath(filename: string, cwd: string): string {
  if (path.isAbsolute(filename)) {
    return path.normalize(filename)
  }
  return path.normalize(path.resolve(cwd, filename))
}

function buildArgs(options: OxlintRunnerOptions, files: string[]): string[] {
  const args: string[] = ['--format=json']

  if (options.oxlintConfigPath) {
    args.push('--config', options.oxlintConfigPath)
  }

  if (options.fix) {
    args.push('--fix')
  }

  if (options.fixSuggestions) {
    args.push('--fix-suggestions')
  }

  if (options.fixDangerously) {
    args.push('--fix-dangerously')
  }

  args.push(...options.extraArgs)
  args.push(...files)
  return args
}

const EXECA_OPTS = { reject: false, stdout: 'pipe', stderr: 'pipe' } as const

async function runOxlint(args: string[], cwd: string) {
  try {
    return await execa('oxlint', args, { cwd, ...EXECA_OPTS })
  } catch (err) {
    if (!(err instanceof ExecaError) || err.code !== 'ENOENT') {
      throw err
    }
  }

  try {
    return await execa('pnpm', ['dlx', 'oxlint', ...args], { cwd, ...EXECA_OPTS })
  } catch (err) {
    if (!(err instanceof ExecaError) || err.code !== 'ENOENT') {
      throw err
    }
  }

  return execa('npx', ['oxlint', ...args], { cwd, ...EXECA_OPTS })
}

function sanitizeVirtualPath(relativePath: string): string {
  const normalized = path.normalize(relativePath)
  if (path.isAbsolute(normalized)) {
    return path.basename(normalized)
  }

  const parts = normalized.split(path.sep).filter((part) => part !== '..' && part !== '')
  if (parts.length === 0) {
    return 'unit.js'
  }

  return parts.join(path.sep)
}

function parseOutput(stdout: string): OxlintJsonOutput {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return { diagnostics: [] }
  }

  return JSON.parse(trimmed) as OxlintJsonOutput
}

export async function runOxlintOnUnits(
  units: VirtualUnit[],
  options: OxlintRunnerOptions,
): Promise<OxlintRunnerResult> {
  if (units.length === 0) {
    return {
      diagnostics: [],
      rewrittenUnitTexts: new Map(),
    }
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oxlint-mdx-'))
  const filePathByUnitId = new Map<string, string>()
  const unitIdByFilePath = new Map<string, string>()

  try {
    for (const unit of units) {
      const safeVirtualPath = sanitizeVirtualPath(unit.virtualFilePath)
      const filePath = path.join(tempDir, unit.id, safeVirtualPath)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, unit.lintText, 'utf8')
      filePathByUnitId.set(unit.id, filePath)
      unitIdByFilePath.set(path.normalize(filePath), unit.id)
    }

    const lintFiles = [...filePathByUnitId.values()]
    const args = buildArgs(options, lintFiles)
    const commandResult = await runOxlint(args, options.cwd)
    const parsed = parseOutput(commandResult.stdout)

    const diagnostics: OxlintRawDiagnostic[] = parsed.diagnostics.map((diagnostic) => {
      const normalizedPath = normalizeDiagnosticPath(diagnostic.filename, options.cwd)
      const unitId = unitIdByFilePath.get(normalizedPath)

      return Object.assign(diagnostic, { filename: unitId ?? diagnostic.filename })
    })

    const rewrittenUnitTexts = new Map<string, string>()

    if (options.fix || options.fixSuggestions || options.fixDangerously) {
      for (const [unitId, filePath] of filePathByUnitId) {
        const rewritten = await fs.readFile(filePath, 'utf8')
        rewrittenUnitTexts.set(unitId, rewritten)
      }
    }

    return {
      diagnostics,
      rewrittenUnitTexts,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}
