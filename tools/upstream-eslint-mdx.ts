import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

export interface EslintMdxParityAssets {
  repoRoot: string
  fixturesRoot: string
  snapshotPath: string
  source: 'env' | 'sibling' | 'node_modules'
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function hasParityAssets(repoRoot: string): Promise<boolean> {
  const fixturesRoot = path.join(repoRoot, 'test/fixtures')
  const snapshotPath = path.join(repoRoot, 'test/__snapshots__/fixtures.test.ts.snap')
  return (await pathExists(fixturesRoot)) && (await pathExists(snapshotPath))
}

function buildAssets(
  repoRoot: string,
  source: EslintMdxParityAssets['source'],
): EslintMdxParityAssets {
  return {
    repoRoot,
    fixturesRoot: path.join(repoRoot, 'test/fixtures'),
    snapshotPath: path.join(repoRoot, 'test/__snapshots__/fixtures.test.ts.snap'),
    source,
  }
}

async function resolvePackageRoot(packageName: string): Promise<string | null> {
  try {
    const require = createRequire(import.meta.url)
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [process.cwd()],
    })
    return path.dirname(packageJsonPath)
  } catch {
    return null
  }
}

/**
 * Resolves upstream eslint-mdx parity assets.
 *
 * Lookup order:
 * 1) ESLINT_MDX_REPO_ROOT
 * 2) sibling checkout at ../eslint-mdx
 * 3) installed package root (if it includes test fixtures/snapshots)
 */
export async function resolveEslintMdxParityAssets(): Promise<EslintMdxParityAssets | null> {
  const envRoot = process.env.ESLINT_MDX_REPO_ROOT
  if (envRoot) {
    const normalized = path.resolve(envRoot)
    if (await hasParityAssets(normalized)) {
      return buildAssets(normalized, 'env')
    }
  }

  const siblingRoot = path.resolve(process.cwd(), '../eslint-mdx')
  if (await hasParityAssets(siblingRoot)) {
    return buildAssets(siblingRoot, 'sibling')
  }

  const packageRoot = await resolvePackageRoot('eslint-mdx')
  if (packageRoot && (await hasParityAssets(packageRoot))) {
    return buildAssets(packageRoot, 'node_modules')
  }

  return null
}

export function parityAssetsMissingMessage(): string {
  return [
    'Upstream eslint-mdx parity assets were not found.',
    'Set ESLINT_MDX_REPO_ROOT to a local eslint-mdx checkout containing test/fixtures and test/__snapshots__/fixtures.test.ts.snap.',
  ].join(' ')
}
