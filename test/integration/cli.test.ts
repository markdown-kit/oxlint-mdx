import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveEslintMdxParityAssets } from '../../tools/upstream-eslint-mdx.ts'

const createdDirs: string[] = []
const upstream = await resolveEslintMdxParityAssets()
const itWithUpstream = upstream ? it : it.skip

function upstreamFixturePath(relativePath: string): string {
  if (!upstream) {
    throw new Error('Upstream eslint-mdx parity assets are not available')
  }

  return path.join(upstream.fixturesRoot, relativePath)
}

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oxlint-mdx-cli-'))
  createdDirs.push(dir)
  return dir
}

async function createFakeOxlint(binDir: string) {
  const scriptPath = path.join(binDir, 'oxlint')
  const script = `#!/usr/bin/env node
const fs = require('node:fs/promises');

void (async () => {
  const args = process.argv.slice(2);
  const hasFix = args.includes('--fix') || args.includes('--fix-suggestions') || args.includes('--fix-dangerously');
  const files = args.filter(arg => !arg.startsWith('-'));

  if (hasFix) {
    for (const filePath of files) {
      const source = await fs.readFile(filePath, 'utf8');
      const next = source.replace(/\\bvar\\b/g, 'const');
      await fs.writeFile(filePath, next, 'utf8');
    }
  }

  const diagnostics = hasFix
    ? []
    : files.map(filePath => ({
        message: 'Unexpected var, use const instead',
        code: 'eslint(no-var)',
        severity: 'error',
        filename: filePath,
        labels: [{ span: { offset: 0, length: 3, line: 1, column: 1 } }],
        causes: [],
        related: [],
      }));

  process.stdout.write(JSON.stringify({ diagnostics }));
})().catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});
`

  await fs.writeFile(scriptPath, script, 'utf8')
  await fs.chmod(scriptPath, 0o755)
  return scriptPath
}

async function createFakeOxlintWithCode(binDir: string, diagnosticCode: string) {
  const scriptPath = path.join(binDir, 'oxlint')
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const files = args.filter(arg => !arg.startsWith('-'));
const diagnostics = files.map(filePath => ({
  message: 'Synthetic diagnostic',
  code: '${diagnosticCode}',
  severity: 'error',
  filename: filePath,
  labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
  causes: [],
  related: [],
}));
process.stdout.write(JSON.stringify({ diagnostics }));
`

  await fs.writeFile(scriptPath, script, 'utf8')
  await fs.chmod(scriptPath, 0o755)
  return scriptPath
}

async function createFakeOxlintExpectArgs(binDir: string, expectedArgs: string[]) {
  const scriptPath = path.join(binDir, 'oxlint')
  const expected = JSON.stringify(expectedArgs)
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const files = args.filter(arg => !arg.startsWith('-'));
const expected = ${expected};
const matched = expected.every((value) => args.includes(value));
const diagnostics = matched
  ? files.map(filePath => ({
      message: 'Passthrough flag matched',
      code: 'eslint(no-var)',
      severity: 'error',
      filename: filePath,
      labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      causes: [],
      related: [],
    }))
  : [];
process.stdout.write(JSON.stringify({ diagnostics }));
`

  await fs.writeFile(scriptPath, script, 'utf8')
  await fs.chmod(scriptPath, 0o755)
  return scriptPath
}

async function runCli(args: string[], cwd: string, pathPrefix: string) {
  return execa('node', ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd,
    reject: false,
    env: {
      ...process.env,
      PATH: `${pathPrefix}:${process.env.PATH ?? ''}`,
    },
  })
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  )
})

describe('cli integration', () => {
  itWithUpstream(
    'does not report parse-error for upstream 336.mdx fixture',
    async () => {
      const fixturePath = upstreamFixturePath('336.mdx')

      const result = await execa(
        'node',
        ['--import', 'tsx', 'src/cli.ts', '--no-remark', '--format', 'json', fixturePath],
        {
          cwd: process.cwd(),
          reject: false,
        },
      )

      const output = JSON.parse(result.stdout) as {
        diagnostics: Array<{ code: string }>
      }

      expect(output.diagnostics.some((diagnostic) => diagnostic.code === 'mdx/parse-error')).toBe(
        false,
      )
    },
    20_000,
  )

  itWithUpstream(
    'does not report parse-error for upstream 576.mdx fixture',
    async () => {
      const fixturePath = upstreamFixturePath('576.mdx')

      const result = await execa(
        'node',
        ['--import', 'tsx', 'src/cli.ts', '--no-remark', '--format', 'json', fixturePath],
        {
          cwd: process.cwd(),
          reject: false,
        },
      )

      const output = JSON.parse(result.stdout) as {
        diagnostics: Array<{ code: string }>
      }

      expect(output.diagnostics.some((diagnostic) => diagnostic.code === 'mdx/parse-error')).toBe(
        false,
      )
    },
    20_000,
  )

  itWithUpstream(
    'matches upstream parse-error behavior for comments.mdx fixture',
    async () => {
      const fixturePath = upstreamFixturePath('comments.mdx')

      const result = await execa(
        'node',
        ['--import', 'tsx', 'src/cli.ts', '--no-remark', '--format', 'json', fixturePath],
        {
          cwd: process.cwd(),
          reject: false,
        },
      )

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(result.stdout) as {
        diagnostics: Array<{ code: string; range: { start: { line: number } } }>
      }

      expect(output.diagnostics.some((diagnostic) => diagnostic.code === 'mdx/parse-error')).toBe(
        true,
      )
      expect(output.diagnostics.some((diagnostic) => diagnostic.range.start.line === 2)).toBe(true)
    },
    20_000,
  )

  itWithUpstream(
    'matches upstream parse-error behavior for details.mdx fixture',
    async () => {
      const fixturePath = upstreamFixturePath('details.mdx')

      const result = await execa(
        'node',
        ['--import', 'tsx', 'src/cli.ts', '--no-remark', '--format', 'json', fixturePath],
        {
          cwd: process.cwd(),
          reject: false,
        },
      )

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(result.stdout) as {
        diagnostics: Array<{ code: string; range: { start: { line: number } } }>
      }

      expect(output.diagnostics.some((diagnostic) => diagnostic.code === 'mdx/parse-error')).toBe(
        true,
      )
      expect(output.diagnostics.some((diagnostic) => diagnostic.range.start.line === 1)).toBe(true)
    },
    20_000,
  )

  itWithUpstream(
    'matches upstream parse-error behavior for acorn.mdx fixture',
    async () => {
      const fixturePath = upstreamFixturePath('acorn.mdx')

      const result = await execa(
        'node',
        ['--import', 'tsx', 'src/cli.ts', '--no-remark', '--format', 'json', fixturePath],
        {
          cwd: process.cwd(),
          reject: false,
        },
      )

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(result.stdout) as {
        diagnostics: Array<{ code: string; range: { start: { line: number } } }>
      }

      expect(output.diagnostics.some((diagnostic) => diagnostic.code === 'mdx/parse-error')).toBe(
        true,
      )
      expect(output.diagnostics.some((diagnostic) => diagnostic.range.start.line === 9)).toBe(true)
    },
    20_000,
  )

  it('reports embedded mdx fence diagnostics with remapped source locations', async () => {
    const fixtureDir = await createTempDir()
    const inputPath = path.join(fixtureDir, 'embedded.md')

    await fs.writeFile(
      inputPath,
      ['Intro text', '', '```mdx', '<!-- invalid mdx comment -->', '<Component />', '```', ''].join(
        '\n',
      ),
      'utf8',
    )

    const result = await execa(
      'node',
      ['--import', 'tsx', 'src/cli.ts', '--format', 'json', inputPath],
      {
        cwd: process.cwd(),
        reject: false,
      },
    )

    expect(result.exitCode).toBe(1)
    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ message: string; range: { start: { line: number } } }>
    }

    expect(output.diagnostics.length).toBeGreaterThan(0)
    expect(
      output.diagnostics.some((diagnostic) => diagnostic.message.includes('Unexpected character')),
    ).toBe(true)
    expect(output.diagnostics.some((diagnostic) => diagnostic.range.start.line >= 4)).toBe(true)
  }, 20_000)

  it('reports parser diagnostics instead of crashing on invalid mdx', async () => {
    const fixtureDir = await createTempDir()
    const inputPath = path.join(fixtureDir, 'invalid.mdx')

    await fs.writeFile(inputPath, '<!-- invalid mdx comment -->\n# Title\n', 'utf8')

    const result = await execa(
      'node',
      ['--import', 'tsx', 'src/cli.ts', '--no-remark', '--format', 'json', inputPath],
      {
        cwd: process.cwd(),
        reject: false,
      },
    )

    expect(result.exitCode).toBe(1)
    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string; filePath: string }>
    }

    expect(output.diagnostics.some((diagnostic) => diagnostic.code === 'mdx/parse-error')).toBe(
      true,
    )
    expect(output.diagnostics.some((diagnostic) => diagnostic.filePath === inputPath)).toBe(true)
  }, 20_000)

  it('remaps oxlint diagnostics back to markdown source locations', async () => {
    const fixtureDir = await createTempDir()
    const fakeBin = await createTempDir()
    await createFakeOxlint(fakeBin)

    const inputPath = path.join(fixtureDir, 'sample.mdx')
    await fs.writeFile(
      inputPath,
      ['# Title', '', '```js', 'var count = 1', '```', ''].join('\n'),
      'utf8',
    )

    const result = await runCli(
      ['--no-remark', '--format', 'json', inputPath],
      process.cwd(),
      fakeBin,
    )
    expect(result.exitCode).toBe(1)

    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{
        filePath: string
        range: { start: { line: number; column: number } }
      }>
    }

    expect(output.diagnostics.length).toBeGreaterThan(0)
    expect(output.diagnostics[0]?.filePath).toBe(inputPath)
    expect(output.diagnostics[0]?.range.start.line).toBe(4)
    expect(output.diagnostics[0]?.range.start.column).toBe(1)
  }, 20_000)

  it('applies remapped fixes back to markdown fenced code blocks', async () => {
    const fixtureDir = await createTempDir()
    const fakeBin = await createTempDir()
    await createFakeOxlint(fakeBin)

    const inputPath = path.join(fixtureDir, 'fixme.mdx')
    await fs.writeFile(
      inputPath,
      ['# Title', '', '```js', 'var total = 10', '```', ''].join('\n'),
      'utf8',
    )

    const result = await runCli(
      ['--no-remark', '--fix', '--format', 'json', inputPath],
      process.cwd(),
      fakeBin,
    )
    expect(result.exitCode).toBe(0)

    const rewritten = await fs.readFile(inputPath, 'utf8')
    expect(rewritten).toContain('const total = 10')
  }, 20_000)

  it('keeps eslint-skip code fences unchanged while fixing others', async () => {
    const fixtureDir = await createTempDir()
    const fakeBin = await createTempDir()
    await createFakeOxlint(fakeBin)

    const inputPath = path.join(fixtureDir, 'skip-and-fix.mdx')
    await fs.writeFile(
      inputPath,
      [
        '```js',
        'var shouldFix = 1',
        '```',
        '',
        '{/* eslint-skip */}',
        '```js',
        'var shouldStay = 2',
        '```',
        '',
      ].join('\n'),
      'utf8',
    )

    const result = await runCli(
      ['--no-remark', '--fix', '--format', 'json', inputPath],
      process.cwd(),
      fakeBin,
    )

    expect(result.exitCode).toBe(0)

    const rewritten = await fs.readFile(inputPath, 'utf8')
    expect(rewritten).toContain('const shouldFix = 1')
    expect(rewritten).toContain('var shouldStay = 2')
  }, 20_000)

  it('does not lint unsupported code fence languages', async () => {
    const fixtureDir = await createTempDir()
    const fakeBin = await createTempDir()
    await createFakeOxlint(fakeBin)

    const inputPath = path.join(fixtureDir, 'mixed.mdx')
    await fs.writeFile(
      inputPath,
      ['```js', 'var x = 1', '```', '', '```log', 'not javascript', '```', ''].join('\n'),
      'utf8',
    )

    const result = await runCli(
      ['--no-remark', '--format', 'json', inputPath],
      process.cwd(),
      fakeBin,
    )
    expect(result.exitCode).toBe(1)

    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ filePath: string }>
    }

    expect(output.diagnostics.length).toBe(1)
  }, 20_000)

  it('lints mdx jsx elements via extracted jsx virtual units', async () => {
    const fixtureDir = await createTempDir()
    const fakeBin = await createTempDir()
    await createFakeOxlint(fakeBin)

    const inputPath = path.join(fixtureDir, 'jsx.mdx')
    await fs.writeFile(inputPath, '<Basic></Basic>\n', 'utf8')

    const result = await runCli(
      ['--no-remark', '--format', 'json', inputPath],
      process.cwd(),
      fakeBin,
    )
    expect(result.exitCode).toBe(1)

    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ filePath: string; range: { start: { line: number; column: number } } }>
    }

    expect(output.diagnostics.length).toBeGreaterThan(0)
    expect(output.diagnostics.some((diagnostic) => diagnostic.filePath === inputPath)).toBe(true)
    expect(output.diagnostics.some((diagnostic) => diagnostic.range.start.line === 1)).toBe(true)
  }, 20_000)

  it('filters unsatisfiable code-block diagnostics from output', async () => {
    const fixtureDir = await createTempDir()
    const fakeBin = await createTempDir()
    await createFakeOxlintWithCode(fakeBin, 'eslint(eol-last)')

    const inputPath = path.join(fixtureDir, 'unsatisfiable.mdx')
    await fs.writeFile(inputPath, ['```js', 'const value = 1', '```', ''].join('\n'), 'utf8')

    const result = await runCli(
      ['--no-remark', '--format', 'json', inputPath],
      process.cwd(),
      fakeBin,
    )
    expect(result.exitCode).toBe(0)

    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string }>
    }

    expect(output.diagnostics).toEqual([])
  }, 20_000)

  it('passes unknown CLI flags through to Oxlint', async () => {
    const fixtureDir = await createTempDir()
    const fakeBin = await createTempDir()
    await createFakeOxlintExpectArgs(fakeBin, ['--sentinel-rule=no-var'])

    const inputPath = path.join(fixtureDir, 'passthrough.mdx')
    await fs.writeFile(inputPath, ['```js', 'const x = 1', '```', ''].join('\n'), 'utf8')

    const result = await runCli(
      ['--no-remark', '--format', 'json', '--sentinel-rule=no-var', inputPath],
      process.cwd(),
      fakeBin,
    )

    expect(result.exitCode).toBe(1)
    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string }>
    }
    expect(output.diagnostics.length).toBeGreaterThan(0)
    expect(output.diagnostics[0]?.code).toBe('eslint(no-var)')
  }, 20_000)

  it('passes explicit `--` arguments through to Oxlint', async () => {
    const fixtureDir = await createTempDir()
    const fakeBin = await createTempDir()
    await createFakeOxlintExpectArgs(fakeBin, ['--sentinel-level', '2'])

    const inputPath = path.join(fixtureDir, 'passthrough-dashdash.mdx')
    await fs.writeFile(inputPath, ['```js', 'const x = 1', '```', ''].join('\n'), 'utf8')

    const result = await runCli(
      ['--no-remark', '--format', 'json', inputPath, '--', '--sentinel-level', '2'],
      process.cwd(),
      fakeBin,
    )

    expect(result.exitCode).toBe(1)
    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string }>
    }
    expect(output.diagnostics.length).toBeGreaterThan(0)
    expect(output.diagnostics[0]?.code).toBe('eslint(no-var)')
  }, 20_000)

  it('does not collide when multiple files use the same code-fence filename metadata', async () => {
    const fixtureDir = await createTempDir()
    const fakeBin = await createTempDir()
    await createFakeOxlint(fakeBin)

    const firstPath = path.join(fixtureDir, 'first.mdx')
    const secondPath = path.join(fixtureDir, 'second.mdx')

    const doc = ['```js filename="shared.js"', 'var item = 1', '```', ''].join('\n')
    await fs.writeFile(firstPath, doc, 'utf8')
    await fs.writeFile(secondPath, doc, 'utf8')

    const result = await runCli(
      ['--no-remark', '--format', 'json', firstPath, secondPath],
      process.cwd(),
      fakeBin,
    )

    expect(result.exitCode).toBe(1)
    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ filePath: string }>
    }

    const paths = output.diagnostics.map((diagnostic) => diagnostic.filePath)
    expect(paths).toContain(firstPath)
    expect(paths).toContain(secondPath)
  }, 20_000)
})
