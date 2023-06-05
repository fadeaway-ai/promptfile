import { parseGlassBlocks } from './parseGlassBlocks'
import { removeGlassComments } from './removeGlassComments'

export interface ChatCompletionRequestMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  name?: string
}

export interface TokenCounter {
  countTokens: (str: string) => number
  // maximum number of tokens allowable by model
  maxTokens: number
  // number of tokens to reserve
  reserveCount?: number
}

export function parseChatCompletionBlocks(
  content: string,
  transcriptTokenCounter: TokenCounter = {
    countTokens: () => 0,
    maxTokens: Infinity,
  }
): ChatCompletionRequestMessage[] {
  const doc = removeGlassComments(content)

  // first interpolate the jsx interpolations
  const nodes = parseGlassBlocks(doc)

  const res: ChatCompletionRequestMessage[] = []

  for (const node of nodes.filter(n => n.type === 'block')) {
    let role = node.tag?.toLowerCase()
    let blockContent = node.child!.content
    if (role === 'transcript') {
      const transcriptContent = node.child!.content
      const transcriptNodes = parseChatCompletionBlocks(transcriptContent)

      const transcriptNodesReversed = transcriptNodes.slice().reverse()
      let totalNumTokensUsed = 0
      const transcriptNodesToKeep = transcriptNodesReversed.filter(n => {
        totalNumTokensUsed += transcriptTokenCounter.countTokens(n.content)
        const amountToReserve = transcriptTokenCounter.reserveCount || transcriptTokenCounter.maxTokens / 5
        return transcriptTokenCounter.maxTokens === Infinity
          ? true
          : transcriptTokenCounter.maxTokens - amountToReserve >= totalNumTokensUsed
      })

      res.push(...transcriptNodesToKeep.slice().reverse())
      continue
    }
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'block') {
      continue // ignore
    }
    if (role === 'block') {
      const roleAttr = node.attrs!.find(attr => attr.name === 'role')
      const contentAttr = node.attrs!.find(attr => attr.name === 'content')
      if (roleAttr == null) {
        throw new Error('<Block> tag must have role attribute')
      }
      role = parseAttr(roleAttr).toLowerCase()
      if (contentAttr != null) {
        blockContent = parseAttr(contentAttr) // TODO: don't modify existing value. don't interpolate content if string literal?
      }
    }
    // return { role: role as any, content: doc }
    res.push({ role: role as any, content: blockContent })
  }

  return res
}

export function parseChatCompletionBlocks2(
  content: string,
  transcriptTokenCounter: TokenCounter = {
    countTokens: () => 0,
    maxTokens: Infinity,
  }
): ChatCompletionRequestMessage[][] {
  const doc = removeGlassComments(content)

  // first interpolate the jsx interpolations
  const nodes = parseGlassBlocks(doc)

  const res: ChatCompletionRequestMessage[][] = []

  let currBlock: ChatCompletionRequestMessage[] = []

  for (const node of nodes.filter(n => n.type === 'block')) {
    if (node.tag === 'Request') {
      res.push(currBlock)
      currBlock = []
    }
    let role = node.tag?.toLowerCase()
    let blockContent = node.child!.content
    if (role === 'transcript') {
      const transcriptContent = node.child!.content
      const transcriptNodes = parseChatCompletionBlocks(transcriptContent)

      const transcriptNodesReversed = transcriptNodes.slice().reverse()
      let totalNumTokensUsed = 0
      const transcriptNodesToKeep = transcriptNodesReversed.filter(n => {
        totalNumTokensUsed += transcriptTokenCounter.countTokens(n.content)
        const amountToReserve = transcriptTokenCounter.reserveCount || transcriptTokenCounter.maxTokens / 5
        return transcriptTokenCounter.maxTokens === Infinity
          ? true
          : transcriptTokenCounter.maxTokens - amountToReserve >= totalNumTokensUsed
      })

      currBlock.push(...transcriptNodesToKeep.slice().reverse())

      continue
    }
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'block') {
      continue // ignore
    }
    if (role === 'block') {
      const roleAttr = node.attrs!.find(attr => attr.name === 'role')
      const contentAttr = node.attrs!.find(attr => attr.name === 'content')
      if (roleAttr == null) {
        throw new Error('<Block> tag must have role attribute')
      }
      role = parseAttr(roleAttr).toLowerCase()
      if (contentAttr != null) {
        blockContent = parseAttr(contentAttr) // TODO: don't modify existing value. don't interpolate content if string literal?
      }
    }
    // return { role: role as any, content: doc }
    currBlock.push({ role: role as any, content: blockContent })
  }

  if (currBlock.length > 0) {
    res.push(currBlock)
  }

  return res
}

function parseAttr(attr: { name: string; stringValue?: string; expressionValue?: string }): string {
  if (attr.stringValue) {
    return attr.stringValue
  }
  if (attr.expressionValue) {
    if (attr.expressionValue.startsWith("'") && attr.expressionValue.endsWith("'")) {
      return attr.expressionValue.slice(1, -1)
    }
    if (attr.expressionValue.startsWith('"') && attr.expressionValue.endsWith('"')) {
      return attr.expressionValue.slice(1, -1)
    }
    return attr.expressionValue
  }
  return ''
}
