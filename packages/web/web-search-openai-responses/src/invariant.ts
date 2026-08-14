/** Package-owned invariant companion. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'web-search-openai-responses-invariant'
export const inject = ['invariants']
/** No runtime invariant: request/response validity is enforced at the provider boundary. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-web-search-openai-responses', install))
