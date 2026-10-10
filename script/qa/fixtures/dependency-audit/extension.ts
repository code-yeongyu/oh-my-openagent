import { Type, type Static } from "typebox"
import { Value } from "typebox/value"
import { sanitizeTerminalLabel } from "@earendil-works/pi-tui"
import { getAgentDir, getPackageDir, resizeImage, sanitizeTerminalLabel as engineLabel, type ExtensionAPI } from "@code-yeongyu/senpi"
import { readFile } from "node:fs/promises"
import { helper } from "./helper.ts"

const Echo = Type.Object({ sentinel: Type.String() })
type Echo = Static<typeof Echo>
const WebRequest = Type.Object({ url: Type.String(), format: Type.Union([Type.Literal("markdown"), Type.Literal("text")]) })
class FixtureInputError extends Error { readonly name = "FixtureInputError" }

// The extension loader requires a default factory export.
export default function auditExtension(pi: ExtensionAPI): void {
  let cwd = process.cwd()
  pi.on("session_start", (_event, context) => {
    cwd = context.cwd
    if (context.hasUI) context.ui.setStatus("audit", "audit-pty-ready")
  })
  pi.rpc.handle("audit.identity", (input) => {
    if (!Value.Check(Echo, input)) throw new FixtureInputError("invalid echo input")
    const data: Echo = input
    return { sentinel: data.sentinel, helperValue: helper.value, cwd, assetUrl: new URL("./wide.png", import.meta.url).href,
      identity: { typebox: Type === helper.Type, tui: sanitizeTerminalLabel === helper.sanitizeTerminalLabel && sanitizeTerminalLabel === engineLabel,
        engine: getAgentDir === helper.getAgentDir }, label: sanitizeTerminalLabel(data.sentinel), agentDir: getAgentDir(), packageDir: getPackageDir() }
  })
  pi.rpc.handle("audit.webfetch", async (input) => {
    if (!Value.Check(WebRequest, input)) throw new FixtureInputError("invalid webfetch input")
    const url = new URL(input.url)
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new FixtureInputError("only loopback HTTP fixtures are allowed")
    return await pi.executeTool("webfetch", { url: input.url, format: input.format, timeout: 10 })
  })
  pi.rpc.handle("audit.photon", async () => {
    const input = await readFile(new URL("./wide.png", import.meta.url))
    return await resizeImage(input, "image/png", { maxWidth: 800, maxHeight: 800, maxBytes: 1048576 })
  })
}
