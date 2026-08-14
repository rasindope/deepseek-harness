/** OpenAI Responses native web-search provider for the harness web seam. */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session'

export const OPENAI_RESPONSES_PROVIDER_ID = 'openai-responses'
export const OPENAI_RESPONSES_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const OPENAI_RESPONSES_DEFAULT_MODEL = 'gpt-5'

const USER_AGENT = 'deepseek-harness/0.0.1'

interface Annotation {
  readonly type?: string
  readonly url?: string
  readonly title?: string
}

interface OutputItem {
  readonly type?: string
  readonly content?: ReadonlyArray<{
    readonly type?: string
    readonly text?: string
    readonly annotations?: readonly Annotation[]
  }>
}

interface CompletedResponse {
  readonly output?: readonly OutputItem[]
}

interface ResponsesEvent {
  readonly type?: string
  readonly item?: OutputItem
  readonly response?: CompletedResponse
  readonly error?: { readonly message?: string }
}

export interface OpenAIResponsesSearchLlmRequest {
  readonly endpoint: string
  readonly body: {
    readonly model: string
    readonly input: string
    readonly tools: readonly [{ readonly type: 'web_search' }]
    readonly tool_choice: { readonly type: 'web_search' }
    readonly stream: true
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'web/openai-responses-search-llm-request': OpenAIResponsesSearchLlmRequest
  }
}

export interface OpenAIResponsesSearchProviderOptions {
  readonly apiKey?: string
  readonly resolveApiKey?: () => Promise<string | undefined>
  readonly apiKeyEnv?: CredentialRef
  readonly baseURL: string
  readonly model: string
  readonly recordRequest?: (request: OpenAIResponsesSearchLlmRequest) => void
}

/** Map the completed Responses object after proving that native search ran. */
export function mapCompletedResponse(response: CompletedResponse, searched: boolean): WebSearchResult {
  const output = response.output ?? []
  if (!searched && !output.some(item => item.type === 'web_search_call')) {
    throw new WebError('Responses API returned no web_search_call', 'WEB_PROVIDER_ERROR')
  }

  const texts: string[] = []
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const item of output) {
    for (const part of item.content ?? []) {
      if (part.type !== 'output_text') continue
      if (part.text != null && part.text.length > 0) texts.push(part.text)
      for (const annotation of part.annotations ?? []) {
        if (annotation.type !== 'url_citation' || annotation.url == null || annotation.url.length === 0 || seen.has(annotation.url)) continue
        seen.add(annotation.url)
        sources.push({
          url: annotation.url,
          ...annotation.title != null && annotation.title.length > 0 ? { title: annotation.title } : {},
        })
      }
    }
  }
  // ponytail: some compatible gateways emit citations only as Markdown links;
  // prefer structured annotations and remove this fallback when they converge.
  if (sources.length === 0) {
    for (const match of texts.join('\n').matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu)) {
      const [, title, url] = match
      if (url == null || seen.has(url)) continue
      seen.add(url)
      sources.push({ url, ...title != null && title.length > 0 ? { title } : {} })
    }
  }
  return {
    ...texts.length > 0 ? { content: texts.join('\n') } : {},
    sources,
    truncated: false,
  }
}

/** Consume a Responses SSE stream until its authoritative completed event. */
export async function parseResponsesStream(stream: ReadableStream<BufferSource>): Promise<WebSearchResult> {
  let searched = false
  const events = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
  for await (const event of events) {
    if (event.data === '[DONE]') break
    let parsed: ResponsesEvent
    try {
      parsed = JSON.parse(event.data) as ResponsesEvent
    } catch (error: unknown) {
      throw new WebError(`Responses API returned malformed SSE: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (parsed.item?.type === 'web_search_call' || parsed.type?.startsWith('response.web_search_call.') === true) searched = true
    if (parsed.type === 'response.failed' || parsed.type === 'response.incomplete') {
      throw new WebError(parsed.error?.message ?? `Responses API ended with ${parsed.type}`, 'WEB_PROVIDER_ERROR')
    }
    if (parsed.type === 'response.completed' && parsed.response !== undefined) {
      return mapCompletedResponse(parsed.response, searched)
    }
  }
  throw new WebError('Responses API stream ended without response.completed', 'WEB_PROVIDER_ERROR')
}

export class OpenAIResponsesSearchProvider implements WebSearchProvider {
  readonly id = OPENAI_RESPONSES_PROVIDER_ID

  constructor(private readonly options: OpenAIResponsesSearchProviderOptions) {}

  available(): boolean {
    return ((this.options.apiKey?.length ?? 0) > 0 || this.options.resolveApiKey !== undefined)
      && URL.canParse(this.options.baseURL)
      && this.options.model.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (isAborted(signal)) throw aborted(signal)
    const apiKey = this.options.apiKey ?? await this.options.resolveApiKey?.()
    if (isAborted(signal)) throw aborted(signal)
    if (apiKey == null || apiKey.length === 0) {
      throw new WebError(`OpenAI Responses search has no API key for "${this.options.apiKeyEnv ?? 'OPENAI_API_KEY'}"`, 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    const baseURL = this.options.baseURL.replace(/\/+$/u, '')
    const endpoint = `${baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`}/responses`
    const body: OpenAIResponsesSearchLlmRequest['body'] = {
      model: this.options.model,
      input: `Perform a web search for the query: ${request.query}`,
      tools: [{ type: 'web_search' }],
      tool_choice: { type: 'web_search' },
      stream: true,
    }
    this.options.recordRequest?.({ endpoint, body })

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'text/event-stream',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAborted(signal) || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`OpenAI Responses search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      let message = `Responses API error (HTTP ${response.status})`
      try {
        const payload = await response.json() as { error?: string | { message?: string }; message?: string }
        const detail = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? payload.message
        if (detail != null && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (isAborted(signal) || isAbortError(error)) throw aborted(signal, error)
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }
    if (response.body === null) throw new WebError('Responses API returned no SSE body', 'WEB_PROVIDER_ERROR')
    try {
      return await parseResponsesStream(response.body)
    } catch (error: unknown) {
      if (isAborted(signal) || isAbortError(error)) throw aborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`Responses API stream failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

function aborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('OpenAI Responses search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? fallback })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false
}
