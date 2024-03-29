import OpenAI from 'openai'
import { print } from 'gluegun'
import { countTokens, estimatedCost } from '../../utils/countTokens'
import { ChatCompletion, ChatRequest, AIMessage } from '../../types'

let _openAI: OpenAI | null = null

// Models: https://platform.openai.com/account/limits
const openAIModel = 'gpt-4-1106-preview' // 128k tokens

export function openAI() {
  if (!_openAI) {
    checkOpenAIKey()

    let api_key = process.env.OPENAI_API_KEY!
    const organization = process.env.OPENAI_ORGANIZATION

    _openAI = new OpenAI({ apiKey: api_key, organization })
  }

  return _openAI
}

// We will store total costs on this object
const _totalCosts = {
  total: {
    promptTokens: 0,
    responseTokens: 0,
    cost: '$0.00',
  },
  last: {
    promptTokens: 0,
    responseTokens: 0,
    cost: '$0.00',
  },
}
export function getTotalCosts() {
  return _totalCosts
}

export const chatGPTPrompt = async (options: Partial<ChatRequest>): Promise<AIMessage> => {
  const ai = openAI()

  const mergedOptions = {
    model: openAIModel,
    messages: [],
    functions: [],
    stream: false,
    user: process.env.USER,
    // provided options override defaults
    ...options,
  }

  // count tokens in the prompt
  const promptTokens = countTokens(JSON.stringify(mergedOptions))

  let response: ChatCompletion
  try {
    response = await ai.chat.completions.create({
      ...mergedOptions,
      stream: false,
    })
  } catch (e: any) {
    // Check for 429 rate limit
    if (e?.response?.status === 429) {
      return {
        content: `ERROR: I'm sorry, I'm being rate limited. Please try again in a few minutes.\n\ncode: too_many_requests\n`,
        role: 'assistant',
      }
    }

    // Check if we went over the token limit
    if (e.response?.data?.error?.code === 'context_length_exceeded') {
      return {
        content: `ERROR: I'm sorry, I went over the token limit. Please try again with a shorter prompt.\n\ncode: ${e.response?.data?.error?.code}\n`,
        role: 'assistant',
      }
    }

    if (e?.error?.code === 'model_not_found') {
      return {
        content: `ERROR: I'm sorry, I couldn't find the model. Are you sure you have access to model ${openAIModel}?\n\ncode: ${e?.error?.code}\n`,
        role: 'assistant',
      }
    }

    console.log('---PROMPT---')
    console.dir({ mergedOptions })
    console.log('---ERROR---')
    console.dir({ response: e.response })

    return {
      content: `ERROR: I'm sorry, I had an error. Please try again.\n\ncode: unknown_error\n`,
      role: 'assistant',
    }
  }

  const message = response.choices[0]?.message

  if (!message) {
    return {
      content: `ERROR: I'm sorry, I had an error. Please try again.\n\ncode: unknown_error\n`,
      role: 'assistant',
    }
  }

  const responseTokens = countTokens(`${message.content}\n${JSON.stringify(message.function_call)}`)
  const costEstimate = estimatedCost(promptTokens, responseTokens)

  // update total costs
  _totalCosts.total.promptTokens += promptTokens
  _totalCosts.total.responseTokens += responseTokens
  _totalCosts.total.cost = estimatedCost(_totalCosts.total.promptTokens, _totalCosts.total.responseTokens)

  // update last costs
  _totalCosts.last.promptTokens = promptTokens
  _totalCosts.last.responseTokens = responseTokens
  _totalCosts.last.cost = costEstimate

  return message
}

export async function createEmbedding(text: string) {
  const ai = openAI()

  const embeddingsResponse = await ai.embeddings.create({
    input: text,
    model: 'text-embedding-ada-002',
  })

  return embeddingsResponse.data
}

export function checkOpenAIKey() {
  if (process.env.OPENAI_API_KEY !== undefined) return true

  print.info('')
  print.error(`Oops -- didn't find an OpenAI key.\n`)
  print.info(print.colors.gray('Please export your OpenAI key as an environment variable.\n'))
  print.highlight('export OPENAI_API_KEY=key_goes_here\n')
  print.info('Get a key here: https://platform.openai.com/account/api-keys')
  print.info('Get access to OpenAI here: https://help.openai.com/en/articles/7102672-how-can-i-access-gpt-4')
  process.exit(1)
}
