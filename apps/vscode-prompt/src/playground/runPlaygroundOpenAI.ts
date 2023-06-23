import { ChatBlock, DEFAULT_TOKEN_COUNTER, TokenCounter, constructGlassDocument } from '@glass-lang/glasslib'
import { FunctionData } from '@glass-lang/glasslib/dist/parseGlassBlocks'
import { checkOk } from '@glass-lang/util'
import fetch from 'node-fetch'
import { handleChatChunk, handleStream } from './stream'

export async function runPlaygroundOpenAI(
  messages: ChatBlock[],
  openaiKey: string,
  model: string,
  functions: FunctionData[],
  options: {
    tokenCounter?: TokenCounter
    progress?: (data: { nextGlassfile: string; response: ChatBlock[] }) => void
  }
): Promise<{
  response: ChatBlock[]
  nextGlassfile: string
}> {
  const tokenCounter = options.tokenCounter || DEFAULT_TOKEN_COUNTER

  const requestTokens = tokenCounter.countTokens(
    messages
      .concat(messages)
      .map(b => `<|im_start|>${b.role}\n${b.content}<|im_end|>`)
      .join(''),
    model
  )

  let functionArgs = {}
  if (functions.length > 0) {
    functionArgs = {
      functions: functions.map(f => ({
        name: f.name,
        description: f.description,
        parameters: f.parameters,
      })),
      function_call: 'auto',
    }
  }

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: messages.map(m => ({ ...m })),
      model: model,
      stream: true,
      ...functionArgs,
    }),
  })

  const response = await handleStream(r, handleChatChunk, next => {
    if (!r.ok) {
      throw new Error(`HTTP error: ${r.status}`)
    }
    if (options?.progress) {
      const newChatBlock: ChatBlock = {
        role: 'assistant',
        content: `${next.content.trim()}█`,
        type: next.function_call ? 'function_call' : undefined,
      }
      const nextGlassfile = constructGlassDocument(messages.concat(newChatBlock), model)
      return options.progress({
        response: [newChatBlock],
        nextGlassfile,
      })
    }
  })

  const assistantBlock: ChatBlock = {
    role: 'assistant',
    content: response.content.trim(),
    type: response.function_call ? 'function_call' : undefined,
  }
  messages.push(assistantBlock)
  if (response.function_call == null) {
    const nextGlassfile = constructGlassDocument(messages, model)
    return {
      response: [assistantBlock],
      nextGlassfile: nextGlassfile,
    }
  }
  const fn = functions.find(f => f.name === response.function_call!.name)!
  checkOk(fn, `Function ${response.function_call!.name} not found`)
  const args = JSON.parse(response.function_call!.arguments)
  const result = await fn.run(args)
  const functionObservation = JSON.stringify(result, null, 2)
  const functionChatBlock: ChatBlock = {
    role: 'function',
    content: functionObservation,
    name: response.function_call!.name,
  }
  messages.push(functionChatBlock)
  return runPlaygroundOpenAI(messages, openaiKey, model, functions, options)
}