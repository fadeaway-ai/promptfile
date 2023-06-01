import fetch from 'node-fetch'
import { Readable } from 'stream'
import { LANGUAGE_MODELS, LanguageModelCreator, LanguageModelType } from './languageModels'
import { parseChatCompletionBlocks } from './parseChatCompletionBlocks'
import { parseGlassBlocks } from './parseGlassBlocks'
import { replaceStateNode, transformGlassDocument, updateRequestOrChatNode } from './transformGlassDocument'

export interface ChatCompletionRequestMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  name?: string
}

export interface TranspilerOutput {
  fileName: string
  model: string
  interpolatedDoc: string
  originalDoc: string
  state: any
  interpolationArgs: any
  onResponse?: (data: {
    message: string
    setText: (text: string) => void
    setNextUserText: (text: string) => void
    continue: () => void
  }) => Promise<any>
}

export async function runGlass(
  { fileName, model, originalDoc, interpolatedDoc, state, onResponse, interpolationArgs }: TranspilerOutput,
  options?: {
    openaiKey?: string
    anthropicKey?: string
    progress?: (data: { nextDoc: string; nextInterpolatedDoc: string; rawResponse?: string }) => void
  }
): Promise<{
  rawResponse: string
  codeResponse?: any
  initDoc: string
  initInterpolatedDoc: string
  finalDoc: string
  finalInterpolatedDoc: string
  continued: boolean
  setText: string | null
  setNextUserText: string | null
}> {
  // replace initDoc instances of
  //
  // ```
  // <Chat.*>
  // (content)
  // </Chat>
  // ```
  //
  // with
  //
  // ```
  // <User>
  // (content)
  // </User>

  const toplevelNodes = parseGlassBlocks(interpolatedDoc)
  const chatNode = toplevelNodes.find(node => node.tag === 'Chat')
  const chatNodeIndex = chatNode ? toplevelNodes.indexOf(chatNode) : -1
  const isChatUserFirst =
    chatNodeIndex !== -1 &&
    !chatNode!.attrs!.some(attr => attr.name === 'initialRole' && attr.stringValue === 'assistant') &&
    (toplevelNodes[chatNodeIndex - 1]?.tag === 'System' || toplevelNodes[chatNodeIndex - 1]?.tag === 'Assistant')

  // eslint-disable-next-line prefer-const
  let { transformedOriginalDoc, transformedInterpolatedDoc } = transformGlassDocument(originalDoc, interpolatedDoc)

  const newStateNode = `<State>\n${JSON.stringify(state, null, 2)}\n</State>`

  if (Object.keys(state).length > 0) {
    transformedOriginalDoc = replaceStateNode(newStateNode, transformedOriginalDoc)
    transformedInterpolatedDoc = replaceStateNode(newStateNode, transformedInterpolatedDoc)
  }

  if (options?.progress) {
    const newRequestNode = requestNodeReplacement(model, '', true)
    options.progress({
      nextDoc: updateRequestOrChatNode(newRequestNode, transformedOriginalDoc),
      nextInterpolatedDoc: updateRequestOrChatNode(newRequestNode, transformedInterpolatedDoc),
      rawResponse: '█',
    })
  }
  const languageModel = LANGUAGE_MODELS.find(m => m.name === model)
  if (!languageModel) {
    throw new Error(`Language model ${model} not found`)
  }
  const res =
    languageModel.creator === LanguageModelCreator.anthropic
      ? await runGlassChatAnthropic(
          fileName,
          model,
          interpolationArgs,
          { originalDoc: transformedOriginalDoc, interpolatedDoc: transformedInterpolatedDoc },
          isChatUserFirst,
          options
        )
      : languageModel.type === LanguageModelType.chat
      ? await runGlassChat(
          fileName,
          model,
          interpolationArgs,
          { originalDoc: transformedOriginalDoc, interpolatedDoc: transformedInterpolatedDoc },
          isChatUserFirst,
          options
        )
      : await runGlassCompletion(
          fileName,
          model as any,
          interpolationArgs,
          { originalDoc: transformedOriginalDoc, interpolatedDoc: transformedInterpolatedDoc },
          isChatUserFirst,
          options
        )

  let codeResponse: any = undefined

  let setNextUserText: string | null = null
  let setText: string | null = null
  let continued = false

  if (onResponse) {
    codeResponse = await onResponse({
      message: res.rawResponse,
      setText: (text: string) => {
        setText = text
      },
      setNextUserText: (text: string) => {
        setNextUserText = text
      },
      continue: () => {
        continued = true
      },
    })
    if (Object.keys(state).length > 0) {
      const finalStateBlock = `<State>\n${JSON.stringify(state, null, 2)}\n</State>`
      res.finalDoc = replaceStateNode(finalStateBlock, res.finalDoc)
      res.finalInterpolatedDoc = replaceStateNode(finalStateBlock, res.finalInterpolatedDoc)
    }
  }

  if (setNextUserText) {
    const newRequestNode = `<User>
${setNextUserText}
</User>`

    res.finalDoc = updateRequestOrChatNode(newRequestNode, res.finalDoc)
    res.finalInterpolatedDoc = updateRequestOrChatNode(newRequestNode, res.finalInterpolatedDoc)
  }

  return {
    ...res,
    initDoc: transformedOriginalDoc,
    initInterpolatedDoc: transformedInterpolatedDoc,
    codeResponse,
    continued,
    setText,
    setNextUserText,
  }
}

const requestNodeReplacement = (model: string, message: string, streaming: boolean) => {
  return `<Assistant model="${model}">
${message}${streaming ? '█' : ''}
</Assistant>`
}

/**
 * Takes a glass template string and interpolation variables and outputs an array of chat messages you can use to prompt ChatGPT API (e.g. gpt-3.5-turbo or gpt-4).
 */
async function runGlassChat(
  fileName: string,
  model: string,
  interpolationArgs: any,
  docs: { interpolatedDoc: string; originalDoc: string },
  isChatUserFirst: boolean,
  options?: {
    openaiKey?: string
    progress?: (data: { nextDoc: string; nextInterpolatedDoc: string; rawResponse?: string }) => void
  }
): Promise<{
  finalDoc: string
  finalInterpolatedDoc: string
  rawResponse: string
}> {
  const messages = parseChatCompletionBlocks(docs.interpolatedDoc, interpolationArgs, isChatUserFirst)
  const requestTokens = console.log('running glass chat', messages)

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      Authorization: `Bearer ${options?.openaiKey || process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      model: model,
      stream: true,
    }),
  })

  const response = await handleStream(r, handleChatChunk, next => {
    // right now claude has a leading whitespace character
    // we need to remove that!
    const updatedRequestNode = requestNodeReplacement(model, next.trim(), options?.progress != null)
    const nextDoc = updateRequestOrChatNode(updatedRequestNode, docs.originalDoc)
    const nextInterpolatedDoc = updateRequestOrChatNode(updatedRequestNode, docs.interpolatedDoc)
    if (options?.progress) {
      return options.progress({
        nextDoc: nextDoc,
        nextInterpolatedDoc,
        rawResponse: next,
      })
    }
  })

  const updatedRequestNode = requestNodeReplacement(model, response, false)
  return {
    finalDoc: updateRequestOrChatNode(updatedRequestNode, docs.originalDoc),
    finalInterpolatedDoc: updateRequestOrChatNode(updatedRequestNode, docs.interpolatedDoc),
    rawResponse: response,
  }
}

/**
 * Takes a glass template string and interpolation variables and outputs an array of chat messages you can use to prompt ChatGPT API (e.g. gpt-3.5-turbo or gpt-4).
 */
async function runGlassChatAnthropic(
  fileName: string,
  model: string,
  interpolationArgs: any,
  docs: { interpolatedDoc: string; originalDoc: string },
  isChatUserFirst: boolean,
  options?: {
    args?: any
    openaiKey?: string
    anthropicKey?: string
    progress?: (data: { nextDoc: string; nextInterpolatedDoc: string; rawResponse?: string }) => void
  }
): Promise<{
  finalDoc: string
  finalInterpolatedDoc: string
  rawResponse: string
}> {
  const messages = parseChatCompletionBlocks(docs.interpolatedDoc, interpolationArgs, isChatUserFirst)

  let anthropicQuery = ''
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      anthropicQuery += `\n\nAssistant: ${msg.content}`
    } else if (msg.role === 'user') {
      anthropicQuery += `\n\nHuman: ${msg.content}`
    } else if (msg.role === 'system') {
      anthropicQuery += `\n\nHuman: ${msg.content}`
    } else {
      throw new Error(`Unknown role for anthropic  query: ${msg.role}`)
    }
  }
  anthropicQuery += '\n\nAssistant: '
  console.log('anthropic query', anthropicQuery)

  const r = await fetch('https://api.anthropic.com/v1/complete', {
    method: 'POST',
    headers: {
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      'X-API-Key': (options?.anthropicKey || process.env.ANTHROPIC_API_KEY)!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      prompt: anthropicQuery,
      max_tokens_to_sample: 2048,
      stopSequences: ['Human:', 'Assistant:'],
      stream: true,
    }),
  })

  const response = await handleStream(r, handleAnthropicChunk, next => {
    const updatedRequestNode = requestNodeReplacement(model, next, options?.progress != null)
    const nextDoc = updateRequestOrChatNode(updatedRequestNode, docs.originalDoc)
    const nextInterpolatedDoc = updateRequestOrChatNode(updatedRequestNode, docs.interpolatedDoc)
    if (options?.progress) {
      return options.progress({
        nextDoc: nextDoc,
        nextInterpolatedDoc,
        rawResponse: next.trim(), // right now claude always returns a leading empty space
      })
    }
  })

  const updatedRequestNode = requestNodeReplacement(model, response.trim(), false)
  return {
    finalDoc: updateRequestOrChatNode(updatedRequestNode, docs.originalDoc),
    finalInterpolatedDoc: updateRequestOrChatNode(updatedRequestNode, docs.interpolatedDoc),
    rawResponse: response.trim(),
  }
}

/**
 * Takes a glass template string and interpolation variables and outputs an array of chat messages you can use to prompt ChatGPT API (e.g. gpt-3.5-turbo or gpt-4).
 */
async function runGlassCompletion(
  fileName: string,
  model: 'gpt-3.5-turbo',
  interpolationArgs: any,
  docs: { interpolatedDoc: string; originalDoc: string },
  isChatUserFirst: boolean,
  options?: {
    args?: any
    openaiKey?: string
    progress?: (data: { nextDoc: string; nextInterpolatedDoc: string; rawResponse?: string }) => void
  }
): Promise<{
  finalDoc: string
  finalInterpolatedDoc: string
  rawResponse: string
}> {
  const messages = parseChatCompletionBlocks(docs.interpolatedDoc, interpolationArgs, isChatUserFirst)
  const useChat = messages.length > 1

  let prompt = ''
  let stopSequence: string | null = null
  if (!useChat) {
    prompt = messages[0].content
  } else {
    stopSequence = '\n\nHuman:'
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        prompt += `\n\nAssistant: ${msg.content}`
      } else if (msg.role === 'user') {
        prompt += `\n\nHuman: ${msg.content}`
      } else if (msg.role === 'system') {
        prompt += `\n\nHuman: ${msg.content}`
      } else {
        throw new Error(`Unknown role for completion query: ${msg.role}`)
      }
    }
    prompt += '\n\nAssistant: '
  }

  console.log('completion conversion query', prompt)

  const r = await fetch('https://api.openai.com/v1/completions', {
    method: 'POST',
    headers: {
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      Authorization: `Bearer ${options?.openaiKey || process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      model: model,
      stream: true,
      stop: stopSequence,
    }),
  })

  const response = await handleStream(r, handleCompletionChunk, next => {
    const updatedRequestNode = requestNodeReplacement(model, next, options?.progress != null)
    const nextDoc = updateRequestOrChatNode(updatedRequestNode, docs.originalDoc)
    const nextInterpolatedDoc = updateRequestOrChatNode(updatedRequestNode, docs.interpolatedDoc)
    if (options?.progress) {
      return options.progress({
        nextDoc: nextDoc,
        nextInterpolatedDoc,
        rawResponse: next,
      })
    }
  })

  const updatedRequestNode = requestNodeReplacement(model, response, false)

  return {
    finalDoc: updateRequestOrChatNode(updatedRequestNode, docs.originalDoc),
    finalInterpolatedDoc: updateRequestOrChatNode(updatedRequestNode, docs.interpolatedDoc),
    rawResponse: response,
  }
}

async function handleStream(
  r: any,
  processChunk: (currResult: string, eventData: any) => string,
  progress: (nextVal: string) => void
) {
  if (!r.ok) {
    throw new Error(`HTTP error: ${r.status}`)
  }

  if (!r.headers.get('content-type').startsWith('text/event-stream')) {
    throw new Error(`Expected "text/event-stream" content type, but received "${r.headers.get('content-type')}"`)
  }

  let fullResult = ''
  const decoder = new TextDecoder()

  await new Promise((resolve, reject) => {
    const readStream = new Readable().wrap(r.body as any)

    readStream.on('data', chunk => {
      const lines = decoder.decode(chunk).split('\n')

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const content = line.slice('data:'.length).trim()
          if (content === '[DONE]') {
            return
          }
          const eventData = JSON.parse(content)
          fullResult = processChunk(fullResult, eventData)
          progress(fullResult)
        }
      }
    })

    readStream.on('end', () => {
      console.log('Stream has been closed by the server.')
      resolve(fullResult)
    })

    readStream.on('error', error => {
      console.log('error on stream', error)
      reject(error)
    })
  })

  return fullResult
}

function handleChatChunk(currResult: string, eventData: { choices: { delta: { content: string } }[] }) {
  if (eventData.choices[0].delta.content) {
    const newResult = currResult + eventData.choices[0].delta.content
    return newResult
  }
  return currResult
}

function handleAnthropicChunk(currResult: string, eventData: { completion: string }) {
  if (eventData.completion) {
    return eventData.completion
  }
  return currResult
}

function handleCompletionChunk(currResult: string, eventData: { choices: { text: string }[] }) {
  if (eventData.choices[0].text) {
    const newResult = currResult + eventData.choices[0].text
    return newResult
  }
  return currResult
}
