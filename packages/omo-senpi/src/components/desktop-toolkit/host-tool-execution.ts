import { z } from "zod"

import type { SenpiExtensionAPI } from "../../extension/types"

export type LoadSdk = () => Promise<unknown>
const defaultLoadSdk: LoadSdk = () => import("@code-yeongyu/senpi")

const Request = z.object({
  name: z.literal("show_html_page"),
  args: z.object({ html: z.string().min(1), title: z.string().min(1).max(200), height: z.number().int().optional() }),
})

/** Runs only the SDK's standalone implementation, in the granting session's own cwd. */
export function registerHostToolExecution(
  pi: SenpiExtensionAPI,
  names: ReadonlySet<string>,
  loadSdk: LoadSdk = defaultLoadSdk,
): void {
  pi.rpc?.handle?.("omo.toolkit.executeHostTool", async (data: unknown, context?: unknown) => {
    const request = Request.safeParse(data)
    // The engine's per-request transport context; dispatching through `admit` ties the write to that request.
    const admitFn = typeof context === "object" && context !== null && "admit" in context && typeof context.admit === "function"
      ? context.admit
      : undefined
    const admit = admitFn === undefined ? undefined : (dispatch: () => unknown) => Reflect.apply(admitFn, context, [dispatch])
    if (!request.success || !names.has(request.data.name) || pi.cwd === undefined || admit === undefined) {
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
      const result: unknown = await admit(() => writeHtmlPage(request.data.args, cwd))
      return result
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { isError: true, content: [{ type: "text", text: error.message }], details: {} }
    }
  })
}
