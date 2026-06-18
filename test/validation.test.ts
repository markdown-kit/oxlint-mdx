import { describe, expect, it } from 'vitest'

import { parseOxlintJsonOutput, parseOxlintMdxUserConfig } from '../src/validation.js'

describe('validation', () => {
  it('rejects runtime-only remark config properties in user config', () => {
    expect(() =>
      parseOxlintMdxUserConfig(
        JSON.stringify({
          remark: {
            cwd: '/tmp/project',
          },
        }),
        '.oxlint-mdxrc.json',
      ),
    ).toThrow('.oxlint-mdxrc.json.remark.cwd is not a supported property')
  })

  it('rejects malformed oxlint diagnostics output', () => {
    expect(() =>
      parseOxlintJsonOutput(
        JSON.stringify({
          diagnostics: [
            {
              message: 'bad severity',
              code: 'eslint(no-var)',
              severity: 'info',
              filename: '/tmp/example.js',
              labels: [],
            },
          ],
        }),
      ),
    ).toThrow('severity must be "error" or "warning"')
  })

  it('treats oxlint no-file output as an empty diagnostics result', () => {
    expect(parseOxlintJsonOutput('No files found, exiting.')).toEqual({ diagnostics: [] })
  })
})
