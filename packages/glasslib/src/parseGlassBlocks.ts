import { checkOk } from '@glass-lang/util'
import { parseGlassTopLevelJsxElements } from './parseGlassTopLevelJsxElements'

export interface GlassContent {
  type: 'block' | 'code' | 'frontmatter'
  content: string
  position: {
    start: { offset: number }
    end: { offset: number }
  }
  tag?: string
  child?: {
    content: string
    position: {
      start: { offset: number }
      end: { offset: number }
    }
  }
  attrs?: { name: string; stringValue?: string; expressionValue?: string }[]
}

export function parseGlassDocument(doc: string): GlassContent[] {
  const blocks = parseGlassBlocks(doc)

  const nonBlocks: GlassContent[] = []
  let start = 0

  for (const block of blocks) {
    if (block.position.start.offset > start) {
      const content = doc.substring(start, block.position.start.offset)
      const frontmatterMatch = content.match(/---\n([\s\S]*?)\n---\n/)

      if (frontmatterMatch) {
        const frontmatterContent = frontmatterMatch[1]
        const frontmatterEnd = frontmatterMatch[0].length

        nonBlocks.push({
          type: 'frontmatter',
          position: { start: { offset: start }, end: { offset: start + frontmatterEnd } },
          content: doc.substring(start, frontmatterEnd),
        })

        start += frontmatterEnd
      }

      nonBlocks.push({
        type: 'code',
        position: { start: { offset: start }, end: { offset: block.position.start.offset } },
        content: doc.substring(start, block.position.start.offset),
      })
    }

    start = block.position.end.offset
  }

  if (start < doc.length) {
    nonBlocks.push({
      type: 'code',
      position: { start: { offset: start }, end: { offset: doc.length } },
      content: doc.substring(start, doc.length),
    })
  }

  const content = [...blocks, ...nonBlocks].sort((a, b) => a.position.start.offset - b.position.start.offset)

  return content
}

export function parseGlassBlocks(doc: string) {
  const blocks: GlassContent[] = []
  const lines = doc.split('\n')

  let docSoFar = ''

  const innerTagStack: string[] = []

  let currTag: string | null = null
  let currTagHasClosed = false
  let currTagHasSelfClosed = false
  let currTagFullContent = ''

  let currContent: string | null = null
  let currTagStartOffset = 0
  let currContentStartOffset = 0
  let currContentEndOffset = 0

  const tagOpenStartRegex = /^<([A-Za-z]+)/
  const tagCloseRegex = /^<\/([A-Za-z]+)>$/
  const tagSelfCloseRegex = /\/>$/
  const tagEndRegex = />$/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const tagStartOpenMatch = line.match(tagOpenStartRegex)
    const tagCloseMatch = line.match(tagCloseRegex)
    const tagSelfCloseMatch = line.match(tagSelfCloseRegex)
    const tagEndRegexMatch = line.match(tagEndRegex)

    if (!tagStartOpenMatch && !currTag) {
      // interstital code, ignore
      docSoFar += line + '\n'
      continue
    }

    if (currTag) {
      currTagFullContent += '\n' + line
    }

    if (tagStartOpenMatch) {
      // opening tag, if we haven't started a block start one now
      if (!currTag) {
        currTag = tagStartOpenMatch[1]
        currContent = null // initialize content
        currTagFullContent = line
        currTagHasClosed = Boolean(tagEndRegexMatch)
        currTagHasSelfClosed = Boolean(tagSelfCloseMatch)
        currTagStartOffset = docSoFar.length
      } else {
        if (!currTagHasClosed) {
          currTagHasClosed = Boolean(tagEndRegexMatch)
          currTagHasSelfClosed = Boolean(tagSelfCloseMatch)
          continue // Don't add to content yet
        }

        // if and only if we're opening another tag with the same name as the current tag, add to inner tag stack
        if (tagStartOpenMatch[1] === currTag) {
          innerTagStack.push(currTag)
        }
        // add to content no matter what
        if (currContent === null) {
          currContent = line
          currContentStartOffset = docSoFar.length
          currContentEndOffset = currContentStartOffset + line.length + 1
        } else {
          currContent += '\n' + line
          currContentEndOffset += line.length + 1
        }
      }
    } else if (currTag && !currTagHasClosed) {
      currTagHasClosed = Boolean(tagEndRegexMatch)
      currTagHasSelfClosed = Boolean(tagSelfCloseMatch)
    } else if (currTagHasClosed) {
      if (currTag && innerTagStack.length === 0 && (tagSelfCloseMatch || tagCloseMatch?.[1] === currTag)) {
        // ignore
      } else {
        // always just add to currContent if not opening tag
        if (currContent === null) {
          currContent = line
          currContentStartOffset = docSoFar.length
          currContentEndOffset = currContentStartOffset + line.length + 1
        } else {
          currContent += '\n' + line
          currContentEndOffset += line.length + 1
        }
      }
    }

    docSoFar += line + '\n'

    if (tagCloseMatch && currTag === tagCloseMatch[1] && innerTagStack.length > 0) {
      // closing an inner tag, ignore it
      innerTagStack.pop()
      continue
    }

    if (tagCloseMatch || currTagHasSelfClosed) {
      const isSame = (tagCloseMatch && tagCloseMatch[1] === currTag) || currTagHasSelfClosed

      if (!currTag || !isSame) {
        continue
      }
      const block: GlassContent = {
        type: 'block',
        tag: currTag,
        attrs: [],
        content: currTagFullContent,
        position: {
          start: { offset: currTagStartOffset },
          end: { offset: docSoFar.length },
        },
        child: {
          content: currContent || '',
          position: {
            start: { offset: currContentStartOffset },
            end: { offset: currContentEndOffset },
          },
        },
      }
      blocks.push(block)
      currTag = null
      currContent = null
      currTagFullContent = ''
      continue
    }
  }

  return parseAttributes(doc, blocks)
}

export function parseGlassBlocksRecursive(doc: string): GlassContent[] {
  const blocks = parseGlassBlocks(doc)
  return blocks.flatMap(b => {
    if (!b.child?.content) {
      return [b]
    }
    if (b.tag !== 'For' && b.tag !== 'Repeat') {
      return [b]
    }
    return [b, ...parseGlassBlocksRecursive(b.child.content)]
  })
}

function parseAttributes(origDoc: string, blocks: GlassContent[]) {
  return blocks.map(b => {
    if (!b.child) {
      return b
    }
    let blockWithoutChildContent = b.content
    if (b.child.content) {
      blockWithoutChildContent =
        origDoc.substring(b.position.start.offset, b.child.position.start.offset) +
        origDoc.substring(b.child.position.end.offset, b.position.end.offset)
    }
    const parsedJsx = parseGlassTopLevelJsxElements(blockWithoutChildContent)
    checkOk(parsedJsx.length === 1, `Expected exactly one top level JSX element in block ${b.content}`)
    return { ...b, attrs: parsedJsx[0].attrs }
  })
}

export function reconstructGlassDocument(nodes: { content: string; type: string }[]): string {
  return nodes
    .map(c => (c.type === 'block' ? c.content + '\n' : c.content))
    .join('')
    .trim()
}
