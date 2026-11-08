import type { ExtensionRpcRequestContext, SenpiExtensionAPI } from "../../extension/types"

export type LoadSdk = () => Promise<unknown>
const defaultLoadSdk: LoadSdk = () => import("@code-yeongyu/senpi")

interface HtmlPageArgs {
  readonly html: string
  readonly title: string
  readonly height?: number
}

interface HostToolRequest {
  readonly name: "show_html_page"
  readonly args: HtmlPageArgs
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// The desktop toolkit runtime is bundled without third-party dependencies, so the request is checked by hand.
function parseRequest(data: unknown): HostToolRequest | undefined {
  if (!isRecord(data) || data.name !== "show_html_page" || !isRecord(data.args)) return undefined
  const { html, title, height } = data.args
  if (typeof html !== "string" || html.length === 0) return undefined
  if (typeof title !== "string" || title.length === 0 || title.length > 200) return undefined
  if (height !== undefined && !Number.isInteger(height)) return undefined
  const args: HtmlPageArgs = typeof height === "number" ? { html, title, height } : { html, title }
  return { name: "show_html_page", args }
}

/** Runs only the SDK's standalone implementation, in the granting session's own cwd. */
export function registerHostToolExecution(
  pi: SenpiExtensionAPI,
  names: ReadonlySet<string>,
  loadSdk: LoadSdk = defaultLoadSdk,
): void {
  pi.rpc?.handle?.("omo.toolkit.executeHostTool", async (data: unknown, context?: ExtensionRpcRequestContext) => {
    const request = parseRequest(data)
    // The engine's per-request transport context; dispatching through `admit` ties the write to that request.
    if (request === undefined || !names.has(request.name) || pi.cwd === undefined || typeof context?.admit !== "function") {
      return { isError: true, content: [{ type: "text", text: "The host tool is not available to this session." }], details: {} }
    }
    const cwd = pi.cwd
    try {
      // The pin bump installs this public SDK export. Checking the module at the
      // boundary reports a broken pin instead of substituting another preparation.
      const sdk = await loadSdk()
      if (typeof sdk !== "object" || sdk === null || !("writeHtmlPage" in sdk) || typeof sdk.writeHtmlPage !== "function") {
        throw new Error("The pinned SDK does not provide writeHtmlPage.")
      }
      const writeHtmlPage = sdk.writeHtmlPage
      const result: unknown = await context.admit(() => writeHtmlPage(request.args, cwd))
      return result
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { isError: true, content: [{ type: "text", text: error.message }], details: {} }
    }
  })
}
