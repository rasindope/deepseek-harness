/** Register the generic OpenAI Responses native web-search provider. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-web'
import {
  OPENAI_RESPONSES_DEFAULT_BASE_URL,
  OPENAI_RESPONSES_DEFAULT_MODEL,
  OpenAIResponsesSearchProvider,
} from './provider.ts'

export * from './provider.ts'

export const name = 'web-search-openai-responses'
export const inject = ['web']

export interface Config {
  /** Literal API key; prefer apiKeyEnv so configuration stays secret-free. */
  readonly apiKey?: string
  /** Credential reference resolved for each search. */
  readonly apiKeyEnv?: string
  /** Responses API base URL. */
  readonly baseURL?: string
  /** Model used for the auxiliary search request. */
  readonly model?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default('OPENAI_API_KEY'),
  baseURL: z.string(),
  model: z.string(),
})

export function apply(ctx: Context, config: Config): void {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? 'OPENAI_API_KEY')
  ctx.web.registerSearchProvider(new OpenAIResponsesSearchProvider({
    ...config.apiKey != null && config.apiKey.length > 0 ? { apiKey: config.apiKey } : {},
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      return launchEnvironmentOf(ctx).get(apiKeyEnv)?.value
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? OPENAI_RESPONSES_DEFAULT_BASE_URL,
    model: config.model ?? OPENAI_RESPONSES_DEFAULT_MODEL,
    recordRequest: request => ctx.get('agents')?.currentInitiator()?.session.append(
      'web/openai-responses-search-llm-request',
      request,
    ),
  }))
}
