/**
 * The Command Code custom provider for `omo setup`: one `commandcode` entry the provider stage writes
 * into the engine's `<agentDir>/models.json`, serving both of Command Code's wire APIs from that single
 * entry. Its Claude models speak the Anthropic wire, so each carries its own `api` and `baseUrl`
 * (`https://api.commandcode.ai/provider`, the client appends `/v1/messages`); everything else speaks the
 * OpenAI wire the provider already carries (`https://api.commandcode.ai/provider/v1`, the client appends
 * `/chat/completions`).
 *
 * The catalog is baked at commit time from one fetch of the public
 * `https://api.commandcode.ai/provider/v1/models` list; the live list can drift, so the written entry
 * stays user-editable in models.json. Setup itself never touches the network. The entry carries no key
 * of its own: the key is read from the environment here and stored as a `${NAME}` config value in the
 * engine's auth.json by the custom-provider stage, which the engine interpolates at every call.
 */

const COMMANDCODE_HOST = "https://api.commandcode.ai"

/** The provider id models.json gets, and the env vars its key is read from. */
export const COMMANDCODE_PROVIDER_ID = "commandcode"
export const COMMANDCODE_KEY_ENV_VARS = ["CMD_API_KEY", "COMMANDCODE_API_KEY"]

// Command Code documents every model at maxTokens 32000 (the engine's default is 16384), so it is set
// explicitly; a context window the baked catalog does not state falls back to the engine's 128000
// default rather than an invented number.
const DEFAULT_CONTEXT_WINDOW = 128000
const MAX_TOKENS = 32000

// One row per baked model, verbatim from the live catalog (`id` is the request's model id, `name` is
// what the engine lists). A model on the Anthropic wire overrides `api` and `baseUrl`; every other one
// inherits the provider's OpenAI wire.
const CATALOG = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", api: "anthropic-messages", contextWindow: 1000000 },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", api: "anthropic-messages", contextWindow: 1000000 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", api: "anthropic-messages", contextWindow: 1000000 },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", api: "anthropic-messages", contextWindow: 1000000 },
  { id: "claude-opus-5", name: "Claude Opus 5", api: "anthropic-messages", contextWindow: 1000000 },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", api: "anthropic-messages", contextWindow: 1000000 },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (latest)", contextWindow: 1000000 },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash (latest)", contextWindow: 1000000 },
  { id: "moonshotai/Kimi-K3.1-Pro", name: "Kimi K3.1 Pro", contextWindow: 1048576 },
  { id: "zai-org/GLM-5.3", name: "GLM-5.3", contextWindow: 1000000 },
  { id: "MiniMaxAI/MiniMax-M3", name: "MiniMax M3", contextWindow: 1000000 },
  { id: "xai/grok-4.7", name: "Grok 4.7", contextWindow: 500000 },
]

function modelEntry(model) {
  return {
    id: model.id,
    name: model.name,
    ...(model.api === undefined ? {} : { api: model.api, baseUrl: `${COMMANDCODE_HOST}/provider` }),
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: MAX_TOKENS,
  }
}

/** The `providers.commandcode` value models.json accepts: the whole baked catalog, user-editable after setup. */
export function commandCodeProvider() {
  return {
    name: "Command Code",
    baseUrl: `${COMMANDCODE_HOST}/provider/v1`,
    api: "openai-completions",
    models: CATALOG.map(modelEntry),
  }
}

/** The env var a key is read from: `CMD_API_KEY` first, `COMMANDCODE_API_KEY` second; unset when none holds a value. */
export function commandCodeKeyEnv(env) {
  for (const name of COMMANDCODE_KEY_ENV_VARS) {
    const value = env[name]
    if (typeof value === "string" && value.trim() !== "") return name
  }
  return undefined
}

/** The provider item the custom-provider stage carries, or undefined while no key env var is set. */
export function commandCodeProviderItem(env) {
  const name = commandCodeKeyEnv(env)
  if (name === undefined) return undefined
  return {
    id: COMMANDCODE_PROVIDER_ID,
    // Setup's own finding, not one read from OpenCode's config: the summary tells the sources apart by it.
    origin: "commandcode",
    config: commandCodeProvider(),
    key: { key: `\${${name}}`, source: `environment variable ${name}` },
  }
}

/**
 * `source` (a `planOpencodeProviders` result) with the Command Code preset appended. A `commandcode`
 * block of the user's own wins in either state the stage can leave it in - carried, or refused with a
 * notice (listed in `skipped`) - so the preset never competes with an entry the user wrote.
 */
export function withCommandCodeProvider(source, env) {
  if (source.providers.some((provider) => provider.id === COMMANDCODE_PROVIDER_ID)
    || source.skipped.includes(COMMANDCODE_PROVIDER_ID)) return source
  const item = commandCodeProviderItem(env)
  return item === undefined ? source : { ...source, providers: [...source.providers, item] }
}
