/**
 * omo's OWN structural view of the senpi JS kernel-tool capability (senpi PR #1728 / item 6).
 *
 * senpi-codemode's implementation is never imported here: the engine pin that ships with omo can
 * predate the producer, so this package duck-types the transient `kernelTools` capability off the
 * live tool-call context and validates every reply structurally. The shapes below mirror the frozen
 * `kernel-tools` contract: fenced descriptors, `describe(names)`,
 * `invoke(request, signal | { signal?, scope? })`, and the typed error-code vocabulary.
 *
 * The per-call execution scope (senpi#1731, PR #1765) is OPTIONAL on purpose: the pinned engine may
 * not carry it, so it is only ever sent when the live capability advertises
 * `capabilities.invokeScope === true`. Nothing here imports a senpi type for it.
 */

export const KERNEL_TOOL_ERROR_CODES = [
  "tools_unavailable",
  "invalid_tool_definition",
  "reserved_tool_name",
  "tool_name_collision",
  "kernel_tool_stale",
  "kernel_tool_missing",
  "kernel_tool_failed",
  "kernel_tool_recursion",
  // A nested host call the invoked closure made was outside the scope this consumer sent. The
  // producer refuses it inside the worker; the child reads it on its own tool-result channel.
  "kernel_tool_host_denied",
  "curated_policy_denied",
] as const

export type KernelToolErrorCode = (typeof KERNEL_TOOL_ERROR_CODES)[number]

const CODES: ReadonlySet<string> = new Set(KERNEL_TOOL_ERROR_CODES)

export class KernelToolError extends Error {
  override readonly name = "KernelToolError"
  readonly code: KernelToolErrorCode

  constructor(code: KernelToolErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** The kernels senpi defines tools in: JavaScript `tool(fn)` and Python `@tool`. */
export type KernelToolLanguage = "js" | "py"

const KERNEL_TOOL_LANGUAGES: ReadonlySet<unknown> = new Set<KernelToolLanguage>(["js", "py"])

export type KernelToolDescriptor = {
  readonly name: string
  readonly description: string
  readonly input_schema: Record<string, unknown>
  readonly language: KernelToolLanguage
  readonly kernel_generation: number
  readonly definition_revision: number
}

export type KernelToolInvokeRequest = {
  readonly name: string
  readonly kernel_generation: number
  readonly definition_revision: number
  readonly args: unknown
  readonly call_id: string
}

/**
 * Host tools the nested calls of ONE invoked closure may reach: `allow` narrows to exactly those
 * names, `deny` refuses the named ones, and `deny` wins where both name the same tool.
 */
export type KernelToolHostScope = {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

/** Execution scope for one `invoke`; call-scoped in the producer and never persisted here. */
export type KernelToolInvokeScope = {
  readonly tools?: KernelToolHostScope
}

export type KernelToolInvokeOptions = {
  readonly signal?: AbortSignal
  readonly scope?: KernelToolInvokeScope
}

// The transient capability the parent's live JS eval publishes on the host tool-call context.
export type KernelToolsCapability = {
  /** Present only on engines that ship the marker; read structurally, never trusted as typed. */
  readonly capabilities?: unknown
  describe(names: readonly string[]): Promise<unknown>
  invoke(request: KernelToolInvokeRequest, options?: AbortSignal | KernelToolInvokeOptions): Promise<unknown>
}

/**
 * The runtime gate for the per-call scope. A pin that predates the producer's scope support carries
 * no marker, so the consumer keeps refusing narrowed grants instead of sending an option that would
 * be silently ignored - which would hand the child a closure running with the PARENT's permissions.
 * Only the literal `true` opts in.
 */
export function supportsInvokeScope(capability: KernelToolsCapability | undefined): boolean {
  if (capability === undefined) return false
  const capabilities = capability.capabilities
  return isRecord(capabilities) && capabilities["invokeScope"] === true
}

export type KernelToolDescribeEntry =
  | { readonly name: string; readonly ok: true; readonly descriptor: KernelToolDescriptor }
  | { readonly name: string; readonly ok: false; readonly error: { readonly code?: string; readonly message: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Duck-type the capability off ANY tool-call context. A context without it (older engine pin,
 * non-JS kernel, or no live eval) yields undefined, which every caller turns into a typed
 * tools_unavailable denial rather than a silent no-tool spawn.
 */
export function readKernelToolsCapability(source: unknown): KernelToolsCapability | undefined {
  if (!isRecord(source)) return undefined
  const capability = source["kernelTools"]
  return isKernelToolsCapability(capability) ? capability : undefined
}

/** The duck-type at the engine-pin boundary: both calls exist, or this is not the capability. */
function isKernelToolsCapability(value: unknown): value is KernelToolsCapability {
  return isRecord(value) && typeof value["describe"] === "function" && typeof value["invoke"] === "function"
}

export function isKernelToolDescriptor(value: unknown): value is KernelToolDescriptor {
  if (!isRecord(value)) return false
  return (
    typeof value["name"] === "string" &&
    value["name"].length > 0 &&
    typeof value["description"] === "string" &&
    isRecord(value["input_schema"]) &&
    KERNEL_TOOL_LANGUAGES.has(value["language"]) &&
    Number.isInteger(value["kernel_generation"]) &&
    Number.isInteger(value["definition_revision"])
  )
}

/**
 * Structurally validate a `describe(names)` reply. A malformed reply is a typed tools_unavailable:
 * an unrecognised engine shape must never be guessed into a grant.
 */
export function parseDescribeResults(value: unknown): readonly KernelToolDescribeEntry[] {
  if (!isRecord(value) || !Array.isArray(value["results"])) {
    throw new KernelToolError("tools_unavailable", "Parent kernel-tool describe reply is not in the expected shape.")
  }
  return value["results"].map((entry) => {
    if (!isRecord(entry) || typeof entry["name"] !== "string") {
      throw new KernelToolError("tools_unavailable", "Parent kernel-tool describe entry is not in the expected shape.")
    }
    const name = entry["name"]
    if (entry["ok"] === true) {
      const descriptor = entry["descriptor"]
      if (!isKernelToolDescriptor(descriptor)) {
        throw new KernelToolError("tools_unavailable", `Parent kernel tool "${name}" returned an unusable descriptor.`)
      }
      return { name, ok: true, descriptor }
    }
    const error = isRecord(entry["error"]) ? entry["error"] : {}
    const message = typeof error["message"] === "string" ? error["message"] : `Kernel tool is not defined: ${name}`
    const code = typeof error["code"] === "string" ? error["code"] : undefined
    return { name, ok: false, error: { message, ...(code === undefined ? {} : { code }) } }
  })
}

/** Read the producer's typed error code off a thrown capability error; anything else is a failure. */
export function kernelToolErrorCode(error: unknown, fallback: KernelToolErrorCode = "kernel_tool_failed"): KernelToolErrorCode {
  if (error instanceof KernelToolError) return error.code
  if (isRecord(error) && typeof error["code"] === "string" && CODES.has(error["code"])) {
    return error["code"] as KernelToolErrorCode
  }
  return fallback
}

export function kernelToolErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
