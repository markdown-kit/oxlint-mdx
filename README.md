# oxlint-mdx

Oxlint-first linting for Markdown and MDX documents.

Current implementation includes:

- fenced code block extraction
- MDX expression / ESM extraction
- diagnostic remapping back to source `.md` / `.mdx`
- fix remapping and write-back to source files
- optional remark bridge diagnostics

## Install from npm

### CLI usage (remote)

- `pnpm dlx @markdownkit/oxlint-mdx "docs/**/*.mdx"`
- `pnpm dlx @markdownkit/oxlint-mdx --fix "docs/**/*.mdx"`

### Project dependency

- `pnpm add -D @markdownkit/oxlint-mdx`

Then run:

- `oxlint-mdx "docs/**/*.mdx"`

## Programmatic usage

The package exports core APIs for embedding in custom workflows:

- `extractVirtualUnits`
- `runOxlintOnUnits`
- `runRemarkBridge`
- remapping helpers from `mapping/*`

Example import:

- `import { extractVirtualUnits, runOxlintOnUnits } from '@markdownkit/oxlint-mdx'`

## Passing Oxlint options through

Forward extra Oxlint options directly:

- `oxlint-mdx docs/**/*.mdx -- --deny no-var --react-plugin`

You can also pass unknown flags directly (without `--`) and they will be forwarded.
For direct flags with values, use `--flag=value` form (for example: `--deny=no-var`).

## Usage

Run in development:

- `pnpm dev -- "docs/**/*.mdx"`

Build and run:

- `pnpm build`
- `node dist/cli.js "docs/**/*.mdx"`

Fix mode:

- `node dist/cli.js --fix "docs/**/*.mdx"`

## Publishing

Publish checks and build run automatically via `prepublishOnly`.

Typical release flow:

1. Bump version in `package.json`
2. `pnpm run test`
3. `pnpm publish --access public`

## Upstream parity assets

Parity scripts/tests use upstream `eslint-mdx` fixture snapshots.

Lookup order:

1. `ESLINT_MDX_REPO_ROOT`
2. sibling checkout at `../eslint-mdx`
3. installed `eslint-mdx` package root (only if it includes test assets)

If assets are unavailable, parity scripts emit a `skipped` JSON payload and upstream parity tests are skipped.
