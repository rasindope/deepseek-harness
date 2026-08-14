import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OpenAIResponsesSearchProvider,
  mapCompletedResponse,
} from '@deepseek-ai/dsh-web-search-openai-responses'

afterEach(() => vi.unstubAllGlobals())

const completed = {
  output: [
    { type: 'web_search_call' },
    {
      type: 'message',
      content: [{
        type: 'output_text',
        text: 'answer',
        annotations: [
          { type: 'url_citation', url: 'https://a.test', title: 'A' },
          { type: 'url_citation', url: 'https://a.test', title: 'duplicate' },
        ],
      }],
    },
  ],
}

function sse(...events: unknown[]): Response {
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

describe('OpenAI Responses web search', () => {
  it('maps the completed answer and deduplicated url citations', () => {
    expect(mapCompletedResponse(completed, false)).toEqual({
      content: 'answer',
      sources: [{ url: 'https://a.test', title: 'A' }],
      truncated: false,
    })
  })

  it('requires proof that native web search ran', () => {
    expect(() => mapCompletedResponse({ output: [] }, false))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps Markdown citations when a compatible gateway omits url_citation annotations', () => {
    expect(mapCompletedResponse({
      output: [
        { type: 'web_search_call' },
        { type: 'message', content: [{ type: 'output_text', text: 'Found it. ([Example](https://example.test/a))' }] },
      ],
    }, false).sources).toEqual([{ url: 'https://example.test/a', title: 'Example' }])
  })

  it('posts a forced streaming web_search request and consumes response.completed', async () => {
    const fetchMock = vi.fn(async () => sse(
      { type: 'response.output_item.added', item: { type: 'web_search_call' } },
      { type: 'response.completed', response: completed },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const recordRequest = vi.fn()
    const provider = new OpenAIResponsesSearchProvider({
      apiKey: 'test-key',
      baseURL: 'https://responses.test',
      model: 'test-model',
      recordRequest,
    })

    await expect(provider.search({ query: 'hello' })).resolves.toMatchObject({ content: 'answer' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string) as unknown
    expect(url).toBe('https://responses.test/v1/responses')
    expect(body).toEqual({
      model: 'test-model',
      input: 'Perform a web search for the query: hello',
      tools: [{ type: 'web_search' }],
      tool_choice: { type: 'web_search' },
      stream: true,
    })
    expect(recordRequest).toHaveBeenCalledWith({ endpoint: url, body })
  })
})
