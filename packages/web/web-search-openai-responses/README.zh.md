# @deepseek-ai/dsh-web-search-openai-responses

[English](README.md) | 中文

这是一个通用 `WebSearchProvider`。它会发起独立的流式 OpenAI Responses 请求并使用原生 `web_search` 工具，然后把完成响应中的答案和 `url_citation` 标注映射为 `WebSearchResult`。它不会修改会话模型 adapter（适配器）或 agent loop（智能体循环）。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | 字面量 API key；优先使用 `apiKeyEnv`。 |
| `apiKeyEnv` | `OPENAI_API_KEY` | 每次搜索时解析的凭据引用。 |
| `baseURL` | `https://api.openai.com/v1` | Responses API 基础地址；缺少 `/v1` 时会自动添加，随后追加 `/responses`。 |
| `model` | `gpt-5` | 辅助搜索请求使用的模型。 |

Provider（提供方）始终发送 `stream: true`，强制使用 `{ type: 'web_search' }`，要求响应中存在 `web_search_call`，拒绝重定向，并在发起会话中记录不含密钥的精确辅助请求。

## 模型体验

### 辅助 Responses 请求

#### 模型看到的内容

配置的搜索模型会在独立请求中看到查询，并且必须使用原生 `web_search`。会话模型只会看到现有 `web_search` 工具及其标准化答案和来源。

#### Token 影响

辅助请求会产生独立的 provider token（提供方词元）；返回的文本和引用会通过工具结果消耗会话 token。

#### KV Cache 影响

辅助请求具有独立的 KV cache（KV 缓存）生命周期，不会使会话前缀失效。

## 已知限制与延后工作

- 目前只映射文本答案和引用；兼容网关缺少 `url_citation` 时会提取 Markdown 链接，而图片及其他 Responses 输出类型会被忽略。
