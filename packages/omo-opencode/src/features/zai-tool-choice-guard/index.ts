import { isRecord } from "@oh-my-opencode/utils"

/**
 * Guards Z.AI/GLM (zai-family) providers against GLM error 1210
 * (`AI_APICallError: API 调用参数有误`): the bundled @ai-sdk/openai-compatible
 * provider serializes `tool_choice` even when the effective function-tool list
 * is empty or names a missing function, and GLM rejects such requests.
 *
 * Fix strategy: inject a sanitizing fetch wrapper into the provider's
 * `options.fetch` during the plugin config hook. opencode reads provider
 * entries AFTER plugin config hooks run and passes `options.fetch` through to
 * `createOpenAICompatible`, so every request body to those providers is
 * sanitized in-process - no proxy needed.
 *
 * Upstream context: https://github.com/code-yeongyu/oh-my-openagent/issues/6753
 */

/** Z.AI / Zhipu GLM provider ids from the models.dev catalog. */
export const ZAI_TOOL_CHOICE_PROVIDER_IDS = [
  "zai",
  "zai-coding-plan",
  "zhipuai",
  "zhipuai-coding-plan",
] as const

const GUARD_BRAND = "__omoZaiToolChoiceGuard"

type FetchInput = Parameters<typeof globalThis.fetch>[0]
type FetchInit = NonNullable<Parameters<typeof globalThis.fetch>[1]>
type FetchLike = (
  input: FetchInput,
  init?: FetchInit,
) => ReturnType<typeof globalThis.fetch>

function isZaiToolChoiceFetchInternal(value: unknown): boolean {
  return (
    typeof value === "function" &&
    (value as unknown as Record<string, unknown>)[GUARD_BRAND] === true
  )
}

export function isZaiToolChoiceFetch(value: unknown): boolean {
  return isZaiToolChoiceFetchInternal(value)
}

/**
 * Removes `tool_choice` from a parsed chat-completion body when GLM would
 * reject it: no tools, empty tools, or a named function absent from `tools`.
 * Valid requests are left byte-identical.
 */
export function stripInvalidToolChoiceFromBody(body: Record<string, unknown>): void {
  if (!("tool_choice" in body)) return

  const tools = Array.isArray(body.tools) ? body.tools : []
  const functionNames = new Set<string>()
  for (const tool of tools) {
    if (!isRecord(tool) || !isRecord(tool.function)) continue
    if (typeof tool.function.name !== "string") continue
    functionNames.add(tool.function.name)
  }

  if (tools.length === 0 || functionNames.size === 0) {
    delete body.tool_choice
    return
  }

  const choice = body.tool_choice
  if (isRecord(choice) && isRecord(choice.function)) {
    const name = choice.function.name
    if (typeof name === "string" && !functionNames.has(name)) {
      delete body.tool_choice
    }
  }
}

async function readRequestBody(
  input: FetchInput,
): Promise<{ text?: string; request?: Request }> {
  if (input instanceof Request) {
    try {
      return { text: await input.clone().text(), request: input }
    } catch {
      return {}
    }
  }
  return {}
}

function rebuildRequest(request: Request, text: string): Request {
  return new Request(request, { body: text, duplex: "half" } as RequestInit)
}

/**
 * Wraps a fetch function so JSON chat-completion bodies are sanitized before
 * transport. Responses (including SSE streams) pass through untouched.
 */
export function createZaiToolChoiceFetch(inner?: FetchLike): FetchLike {
  if (isZaiToolChoiceFetchInternal(inner)) {
    return inner as FetchLike
  }

  const guarded = async (
    input: FetchInput,
    init?: FetchInit,
  ): Promise<Response> => {
    let patchedInput: FetchInput = input
    let patchedInit: FetchInit | undefined = init

    if (typeof init?.body === "string" && init.body.includes("tool_choice")) {
      const parsed: unknown = JSON.parse(init.body)
      if (isRecord(parsed)) {
        stripInvalidToolChoiceFromBody(parsed)
        patchedInit = { ...init, body: JSON.stringify(parsed) }
      }
    } else if (!init?.body && input instanceof Request) {
      const { text, request } = await readRequestBody(input)
      if (text && request && text.includes("tool_choice")) {
        const parsed: unknown = JSON.parse(text)
        if (isRecord(parsed)) {
          stripInvalidToolChoiceFromBody(parsed)
          patchedInput = rebuildRequest(request, JSON.stringify(parsed))
        }
      }
    }

    const transport = inner ?? globalThis.fetch
    return transport(patchedInput, patchedInit)
  }

  Object.defineProperty(guarded, GUARD_BRAND, { value: true })
  return guarded
}

/**
 * Injects the guard into every zai-family provider entry of opencode's live
 * config. Entries are created when absent (opencode merges them over the
 * models.dev catalog entry); user-set fetch functions are wrapped, never
 * replaced. Idempotent.
 */
export function applyZaiToolChoiceGuard(config: Record<string, unknown>): void {
  const existingProviders = config.provider
  const providers: Record<string, unknown> = isRecord(existingProviders)
    ? existingProviders
    : {}
  config.provider = providers

  for (const providerID of ZAI_TOOL_CHOICE_PROVIDER_IDS) {
    const existingProvider = providers[providerID]
    const provider: Record<string, unknown> = isRecord(existingProvider)
      ? existingProvider
      : {}
    providers[providerID] = provider

    const rawOptions = provider.options
    const options: Record<string, unknown> = isRecord(rawOptions) ? rawOptions : {}
    provider.options = options

    const currentFetch = options.fetch
    if (isZaiToolChoiceFetchInternal(currentFetch)) continue
    options.fetch = createZaiToolChoiceFetch(
      typeof currentFetch === "function" ? (currentFetch as unknown as FetchLike) : undefined,
    )
  }
}
