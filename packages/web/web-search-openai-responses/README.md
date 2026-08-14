# @deepseek-ai/dsh-web-search-openai-responses

English | [中文](README.zh.md)

A generic `WebSearchProvider` that makes a separate streaming OpenAI Responses request with the native `web_search` tool, then maps the completed answer and `url_citation` annotations into `WebSearchResult`. It does not modify the conversation model adapter or agent loop.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | unset | Literal API key; prefer `apiKeyEnv`. |
| `apiKeyEnv` | `OPENAI_API_KEY` | Credential reference resolved for each search. |
| `baseURL` | `https://api.openai.com/v1` | Responses API base; `/v1` is added when absent, then `/responses`. |
| `model` | `gpt-5` | Model used for the auxiliary search request. |

The provider always sends `stream: true`, forces `{ type: 'web_search' }`, requires a `web_search_call`, rejects redirects, and records the exact secret-free auxiliary request in the initiating session.

## Model Experience

### Auxiliary Responses request

#### What the model sees

The configured search model sees the query in a separate request and must use native `web_search`. The conversation model sees only the existing `web_search` tool and its normalized answer and sources.

#### Token effect

The auxiliary request incurs independent provider tokens; returned text and citations consume conversation tokens through the tool result.

#### KV Cache effect

The auxiliary request has an independent KV-cache lifecycle and does not invalidate the conversation prefix.

## Known Limitations and Deferred Work

- Only text answers and citations are mapped; compatible gateways that omit `url_citation` use Markdown-link extraction, while images and other Responses output types are ignored.
