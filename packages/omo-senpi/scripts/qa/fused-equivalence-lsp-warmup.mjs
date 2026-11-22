import { realpathSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const MAX_FRESHNESS_WINDOWS = 10

export async function waitForE24TypeScript(diagnose) {
  let lastMiss
  for (let attempt = 0; attempt < MAX_FRESHNESS_WINDOWS; attempt++) {
    const { content, details, isError } = await diagnose()
    const text = content.map((block) => block.text).join("\n")
    if (!isError && text.includes("error[typescript] (2322)")) return

    // Before a push-only server's first publish, lsp-core can return an empty result at the freshness deadline.
    // Asking again for the same document waits on diagnostics activity without reopening it or sleeping here.
    if (details?.errorKind === "freshness_timeout") lastMiss = `freshness_timeout: ${text}`
    else if (!isError && !details?.availability && details?.totalDiagnostics === 0) lastMiss = text
    else throw new Error(`E24: TypeScript warmup failed: ${text}`)
  }
  throw new Error(`E24: TypeScript warmup did not receive TS2322 after ${MAX_FRESHNESS_WINDOWS} requests: ${lastMiss}`)
}

if (import.meta.main) {
  // Reuse the adapter's daemon client and request context, but do not register or run a Senpi tool.
  const { callPackagedDaemonTool } = await import("../../src/components/lsp/daemon-tool-client.ts")
  const importer = new URL("../../plugin/extensions/omo.js", import.meta.url).href
  const cwd = realpathSync(process.cwd())
  const filePath = join(cwd, "eq-lsp-preflight.ts")
  writeFileSync(filePath, "export const eqPreflight: string = 1\n", { flag: "wx" })
  try {
    await waitForE24TypeScript(() =>
      callPackagedDaemonTool("lsp_diagnostics", { filePath, severity: "error" }, { cwd }, importer),
    )
  } finally {
    unlinkSync(filePath)
  }
}
