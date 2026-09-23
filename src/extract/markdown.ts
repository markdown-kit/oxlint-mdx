import path from 'node:path'

import remarkFrontmatter from 'remark-frontmatter'
import remarkMath from 'remark-math'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { mapLanguage } from '../config/load.js'
import type { RangeMapEntry, SourceDocument, VirtualUnit } from '../types.js'
import { getLineStartOffset } from '../utils/lines.js'

interface PositionLike {
  start: { offset?: number }
  end: { offset?: number }
}

interface NodeWithPosition {
  type: string
  value?: unknown
  lang?: string | null
  meta?: string | null
  data?: {
    estree?: {
      range?: [number, number]
    }
  }
  attributes?: MdxJsxAttributeLike[]
  name?: string | null
  position?: PositionLike
  children?: unknown[]
}

interface MdxJsxAttributeNode extends NodeWithPosition {
  type: 'mdxJsxAttribute'
  value?: string | null | NodeWithPosition
}

interface MdxJsxExpressionAttributeNode extends NodeWithPosition {
  type: 'mdxJsxExpressionAttribute'
}

type MdxJsxAttributeLike = MdxJsxAttributeNode | MdxJsxExpressionAttributeNode

interface FencedCodeNode extends NodeWithPosition {
  type: 'code'
  value: string
  lang?: string | null
  meta?: string | null
  position: { start: { offset: number }; end: { offset: number } }
}

const LEADING_WHITESPACE_REGEX = /^[>\s]*/u
const CODEBLOCK_FILENAME_REGEX = /filename=(?<quote>["'])(?<filename>.*?)\k<quote>/u

const HTML_COMMENT_REGEX = /^<!-{2,}([\s\S]*?)-{2,}>$/u
const MDX_COMMENT_REGEX = /^\/\*+([\s\S]*?)\*+\/$/u
const ESLINT_DIRECTIVE_REGEX = /^(?:eslint\b|global\s|eslint-skip\b)/u

function hasOffsets(node: NodeWithPosition): node is NodeWithPosition & {
  position: { start: { offset: number }; end: { offset: number } }
} {
  return (
    node.position != null &&
    typeof node.position.start.offset === 'number' &&
    typeof node.position.end.offset === 'number'
  )
}

function isNodeWithPosition(value: unknown): value is NodeWithPosition {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

function isFencedCodeNode(value: unknown): value is FencedCodeNode {
  return (
    isNodeWithPosition(value) &&
    value.type === 'code' &&
    hasOffsets(value) &&
    typeof value.value === 'string'
  )
}

function getAttributeExpressionNode(attribute: MdxJsxAttributeLike): NodeWithPosition | undefined {
  if (attribute.type === 'mdxJsxExpressionAttribute') {
    return attribute
  }

  if (isNodeWithPosition(attribute.value)) {
    return attribute.value
  }

  return undefined
}

function getDirectiveComment(node: NodeWithPosition): string {
  if (typeof node.value !== 'string') {
    return ''
  }

  const candidate =
    node.type === 'html'
      ? (HTML_COMMENT_REGEX.exec(node.value)?.[1]?.trim() ?? '')
      : (MDX_COMMENT_REGEX.exec(node.value)?.[1]?.trim() ?? '')

  if (!candidate || !ESLINT_DIRECTIVE_REGEX.test(candidate)) {
    return ''
  }

  return candidate
}

function getCodeContentRange(
  text: string,
  node: NodeWithPosition & { position: { start: { offset: number }; end: { offset: number } } },
) {
  const openingFenceLineEnd = text.indexOf('\n', node.position.start.offset)

  if (openingFenceLineEnd === -1) {
    return {
      start: node.position.start.offset,
      end: node.position.end.offset,
      trailingNewline: false,
    }
  }

  const contentStart = openingFenceLineEnd + 1
  const closingFenceLineStart = text.lastIndexOf('\n', node.position.end.offset - 1)
  // With CRLF line endings the `\r` before the closing fence belongs to the line
  // ending, not the code (the mdast value excludes it); keep it out of the
  // replaced range so a fix does not drop it.
  const lineEndingStart =
    text[closingFenceLineStart - 1] === '\r' ? closingFenceLineStart - 1 : closingFenceLineStart
  const contentEnd = Math.max(contentStart, lineEndingStart)
  const contentSlice = text.slice(contentStart, contentEnd)

  return {
    start: contentStart,
    end: contentEnd,
    trailingNewline: contentSlice.endsWith('\n'),
  }
}

function buildSimpleRangeMap(
  sourceStartOffset: number,
  sourceEndOffset: number,
  prefixLength: number,
  sourceTextLength: number,
): RangeMapEntry[] {
  const entries: RangeMapEntry[] = [
    {
      virtualOffset: 0,
      sourceOffsetDelta: sourceStartOffset,
    },
    {
      virtualOffset: prefixLength,
      sourceOffsetDelta: sourceStartOffset - prefixLength,
    },
    {
      virtualOffset: prefixLength + sourceTextLength,
      sourceOffsetDelta: sourceEndOffset - (prefixLength + sourceTextLength),
    },
  ]

  return entries
}

function buildCodeBlockRangeMap(
  text: string,
  node: NodeWithPosition & { position: { start: { offset: number }; end: { offset: number } } },
  sourceStartOffset: number,
  sourceEndOffset: number,
  lintBody: string,
  prefixLength: number,
): { rangeMap: RangeMapEntry[]; baseIndent: string } {
  const lineStartOffset = getLineStartOffset(text, node.position.start.offset)
  const leadingPrefix = text.slice(lineStartOffset, node.position.start.offset)
  const baseIndent = LEADING_WHITESPACE_REGEX.exec(leadingPrefix)?.[0] ?? ''
  const baseIndentLength = baseIndent.length

  // The lint body is the mdast value (block indentation stripped); the source
  // lines must come from the real source range, which is longer by the
  // stripped indentation on every line. Slicing by the body's length instead
  // truncated trailing lines and shifted every later mapping by the indent.
  const virtualLines = lintBody.split('\n')
  const sourceLines = text.slice(sourceStartOffset, sourceEndOffset).split('\n')

  const rangeMap: RangeMapEntry[] = [
    {
      virtualOffset: 0,
      sourceOffsetDelta: sourceStartOffset,
    },
  ]

  let virtualOffset = prefixLength
  let sourceOffset = sourceStartOffset

  for (let index = 0; index < virtualLines.length; index += 1) {
    const virtualLine = virtualLines[index]
    const sourceLine = sourceLines[index] ?? virtualLine
    const leadingWhitespaceLength = LEADING_WHITESPACE_REGEX.exec(sourceLine)?.[0].length ?? 0
    const trimLength = Math.min(baseIndentLength, leadingWhitespaceLength)

    rangeMap.push({
      virtualOffset,
      sourceOffsetDelta: sourceOffset + trimLength - virtualOffset,
    })

    const isLastLine = index === virtualLines.length - 1
    virtualOffset += virtualLine.length + (isLastLine ? 0 : 1)
    sourceOffset += sourceLine.length + (isLastLine ? 0 : 1)
  }

  return { rangeMap, baseIndent }
}

function sanitizeFileName(name: string): string {
  return name.replace(/\s+/gu, '_')
}

function buildVirtualPath(
  sourceFilePath: string,
  id: string,
  extension: string,
  overrideFileName?: string,
): string {
  if (overrideFileName && overrideFileName.trim()) {
    const cleaned = sanitizeFileName(overrideFileName.trim())
    return cleaned
  }

  const stem = path.basename(sourceFilePath).replace(/[^a-zA-Z0-9._-]/gu, '_')

  return `${stem}__${id}.${extension}`
}

function parseCodeBlockFileName(meta?: string | null): string | undefined {
  if (!meta) {
    return undefined
  }

  const groups = CODEBLOCK_FILENAME_REGEX.exec(meta)?.groups
  const fileName = groups?.filename?.trim()
  return fileName ?? undefined
}

const JSX_CONTENT_TYPES = new Set([
  'mdxJsxFlowElement',
  'mdxJsxTextElement',
  'mdxFlowExpression',
  'mdxTextExpression',
])

/**
 * Whether a JSX element's source slice is parseable as JSX: every descendant is
 * itself a JSX element or an MDX expression. Markdown children (paragraphs,
 * blockquotes, code, even plain text, which may contain `>` or `}`) are not JSX
 * syntax, so linting such a slice as JSX reports false parse errors.
 */
function hasOnlyJsxContent(node: NodeWithPosition): boolean {
  return (node.children ?? []).every(
    (child) =>
      isNodeWithPosition(child) && JSX_CONTENT_TYPES.has(child.type) && hasOnlyJsxContent(child),
  )
}

function walk(node: unknown, visit: (entry: NodeWithPosition) => void): void {
  if (!isNodeWithPosition(node)) {
    return
  }

  visit(node)
  for (const child of node.children ?? []) {
    walk(child, visit)
  }
}

function wrapExpression(value: string): {
  lintText: string
  prefixLength: number
  suffixLength: number
} {
  const prefix = '('
  const suffix = ')'
  return {
    lintText: `${prefix}${value}${suffix}`,
    prefixLength: prefix.length,
    suffixLength: suffix.length,
  }
}

function wrapSpreadExpression(value: string): {
  lintText: string
  prefixLength: number
  suffixLength: number
} {
  const prefix = '({'
  const suffix = '})'
  return {
    lintText: `${prefix}${value}${suffix}`,
    prefixLength: prefix.length,
    suffixLength: suffix.length,
  }
}

function getExpressionRangeFromNode(node: NodeWithPosition): [number, number] | null {
  const range = node.data?.estree?.range
  if (
    Array.isArray(range) &&
    range.length === 2 &&
    typeof range[0] === 'number' &&
    typeof range[1] === 'number' &&
    range[1] >= range[0]
  ) {
    return [range[0], range[1]]
  }

  if (hasOffsets(node)) {
    const start = node.position.start.offset + 1
    const end = Math.max(start, node.position.end.offset - 1)
    return [start, end]
  }

  return null
}

export interface ExtractOptions {
  languageMapper: Record<string, string> | false
  isMdx?: boolean
}

export function extractVirtualUnits(
  document: SourceDocument,
  options: ExtractOptions,
): VirtualUnit[] {
  const inferredIsMdx = path.extname(document.filePath).toLowerCase() === '.mdx'
  const isMdx = options.isMdx ?? inferredIsMdx

  const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMath)
  if (isMdx) {
    parser.use(remarkMdx)
  }

  const root = parser.parse(document.text)
  const units: VirtualUnit[] = []
  let unitCounter = 0
  let fencedCodeCounter = 0
  let pendingDirectives: string[] = []
  const expressionRangeDedup = new Set<string>()
  const jsxElementRanges: Array<{ start: number; end: number }> = []

  function pushExpressionUnit(
    kind: VirtualUnit['kind'],
    sourceStartOffset: number,
    sourceEndOffset: number,
    sourceText: string,
    wrap: { lintText: string; prefixLength: number; suffixLength: number },
  ) {
    const key = `${sourceStartOffset}:${sourceEndOffset}:${kind}`
    if (expressionRangeDedup.has(key)) {
      return
    }
    expressionRangeDedup.add(key)

    const id = `unit_${unitCounter++}`
    units.push({
      id,
      kind,
      sourceFilePath: document.filePath,
      virtualFilePath: buildVirtualPath(document.filePath, id, 'jsx'),
      language: 'jsx',
      lintText: wrap.lintText,
      sourceText,
      sourceStartOffset,
      sourceEndOffset,
      sourceHasTrailingNewline: false,
      baseIndent: '',
      prefixLength: wrap.prefixLength,
      suffixLength: wrap.suffixLength,
      rangeMap: buildSimpleRangeMap(
        sourceStartOffset,
        sourceEndOffset,
        wrap.prefixLength,
        sourceText.length,
      ),
      skip: false,
    })
  }

  function pushJsxElementUnit(sourceStartOffset: number, sourceEndOffset: number) {
    for (const existing of jsxElementRanges) {
      if (sourceStartOffset >= existing.start && sourceEndOffset <= existing.end) {
        return
      }
    }

    jsxElementRanges.push({ start: sourceStartOffset, end: sourceEndOffset })

    const sourceText = document.text.slice(sourceStartOffset, sourceEndOffset)
    const id = `unit_${unitCounter++}`
    units.push({
      id,
      kind: 'mdx-jsx-element',
      sourceFilePath: document.filePath,
      virtualFilePath: buildVirtualPath(document.filePath, id, 'jsx'),
      language: 'jsx',
      lintText: sourceText,
      sourceText,
      sourceStartOffset,
      sourceEndOffset,
      sourceHasTrailingNewline: sourceText.endsWith('\n'),
      baseIndent: '',
      prefixLength: 0,
      suffixLength: 0,
      rangeMap: buildSimpleRangeMap(sourceStartOffset, sourceEndOffset, 0, sourceText.length),
      skip: false,
    })
  }

  walk(root, (node) => {
    if (
      node.type === 'html' ||
      node.type === 'mdxFlowExpression' ||
      node.type === 'mdxTextExpression'
    ) {
      const directive = getDirectiveComment(node)
      if (directive) {
        pendingDirectives.push(directive)
        return
      }
    }

    if (node.type === 'code') {
      if (!isFencedCodeNode(node) || typeof node.lang !== 'string' || !node.lang.trim()) {
        pendingDirectives = []
        return
      }

      const codeNode = node
      const rawLanguage = codeNode.lang ?? ''
      const language = rawLanguage.trim().split(/\s+/u)[0]
      const mappedLanguage = mapLanguage(language, options.languageMapper)
      const metaFileName = parseCodeBlockFileName(codeNode.meta)
      const defaultFileName = `${fencedCodeCounter}.${mappedLanguage}`
      fencedCodeCounter += 1
      const directives = pendingDirectives
      pendingDirectives = []

      const shouldSkip = directives.includes('eslint-skip')
      const commentPrefix = directives
        .filter((comment) => comment !== 'eslint-skip')
        .map((comment) => `/* ${comment} */`)
        .join('\n')

      const prefixLength = commentPrefix ? commentPrefix.length + 1 : 0
      const lintBody = typeof codeNode.value === 'string' ? codeNode.value : ''
      const lintText = commentPrefix ? `${commentPrefix}\n${lintBody}` : lintBody

      const { start, end, trailingNewline } = getCodeContentRange(document.text, codeNode)
      const sourceText = document.text.slice(start, end)
      const { rangeMap, baseIndent } = buildCodeBlockRangeMap(
        document.text,
        codeNode,
        start,
        end,
        lintBody,
        prefixLength,
      )

      const id = `unit_${unitCounter++}`
      units.push({
        id,
        kind: 'fenced-code',
        sourceFilePath: document.filePath,
        virtualFilePath: buildVirtualPath(
          document.filePath,
          id,
          mappedLanguage,
          metaFileName ?? defaultFileName,
        ),
        language: mappedLanguage,
        lintText,
        sourceText,
        sourceStartOffset: start,
        sourceEndOffset: end,
        sourceHasTrailingNewline: trailingNewline,
        baseIndent,
        prefixLength,
        suffixLength: 0,
        rangeMap,
        skip: shouldSkip,
      })

      return
    }

    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      if (!hasOffsets(node) || typeof node.value !== 'string') {
        pendingDirectives = []
        return
      }

      const sourceStartOffset = node.position.start.offset + 1
      const sourceEndOffset = Math.max(sourceStartOffset, node.position.end.offset - 1)
      const sourceText = document.text.slice(sourceStartOffset, sourceEndOffset)
      const wrapped = wrapExpression(sourceText)

      pushExpressionUnit(
        node.type === 'mdxFlowExpression' ? 'mdx-flow-expression' : 'mdx-text-expression',
        sourceStartOffset,
        sourceEndOffset,
        sourceText,
        wrapped,
      )

      pendingDirectives = []
      return
    }

    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      if (hasOffsets(node) && hasOnlyJsxContent(node)) {
        pushJsxElementUnit(node.position.start.offset, node.position.end.offset)
      }

      for (const attribute of node.attributes ?? []) {
        const valueExpressionNode = getAttributeExpressionNode(attribute)

        if (!valueExpressionNode || typeof valueExpressionNode !== 'object') {
          continue
        }

        const range = getExpressionRangeFromNode(valueExpressionNode)
        if (!range) {
          continue
        }

        const [sourceStartOffset, sourceEndOffset] = range
        const sourceText = document.text.slice(sourceStartOffset, sourceEndOffset)
        if (!sourceText.trim()) {
          continue
        }

        const wrapped = sourceText.trimStart().startsWith('...')
          ? wrapSpreadExpression(sourceText)
          : wrapExpression(sourceText)

        pushExpressionUnit(
          'mdx-jsx-attribute-expression',
          sourceStartOffset,
          sourceEndOffset,
          sourceText,
          wrapped,
        )
      }

      pendingDirectives = []
      return
    }

    if (node.type === 'mdxjsEsm') {
      if (!hasOffsets(node)) {
        pendingDirectives = []
        return
      }

      const sourceStartOffset = node.position.start.offset
      const sourceEndOffset = node.position.end.offset
      const sourceText = document.text.slice(sourceStartOffset, sourceEndOffset)
      const id = `unit_${unitCounter++}`

      units.push({
        id,
        kind: 'mdx-esm',
        sourceFilePath: document.filePath,
        virtualFilePath: buildVirtualPath(document.filePath, id, 'js'),
        language: 'js',
        lintText: sourceText,
        sourceText,
        sourceStartOffset,
        sourceEndOffset,
        sourceHasTrailingNewline: sourceText.endsWith('\n'),
        baseIndent: '',
        prefixLength: 0,
        suffixLength: 0,
        rangeMap: buildSimpleRangeMap(sourceStartOffset, sourceEndOffset, 0, sourceText.length),
        skip: false,
      })

      pendingDirectives = []
      return
    }

    pendingDirectives = []
  })

  return units
}
