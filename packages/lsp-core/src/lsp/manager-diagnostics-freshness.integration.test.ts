import { rmSync } from "node:fs"
import { expect, it } from "bun:test"

import { disposeDefaultLspManager, getLspManager } from "./manager.js"
import { createFixture } from "./workspace-apply-edit-test-support.js"

it("uses the process freshness budget for diagnostics from a default-managed client (#9271)", async () => {
  const key = "OMO_LSP_DIAGNOSTICS_FRESHNESS_TIMEOUT_MS"
  const previous = process.env[key]
  const dirs: string[] = []
  await disposeDefaultLspManager()
  try {
    process.env[key] = "75"
    const fixture = createFixture(
      {
        capabilities: { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } },
        diagnosticResponses: [{ action: "hang" }],
      },
      dirs,
    )
    const client = await getLspManager().getClient(fixture.workspace, fixture.server)
    const result = await client.diagnostics(fixture.paths.source)
    expect(result.transientError?.kind).toBe("freshness_timeout")
    expect(result.transientError?.message).toContain("within 75ms")
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
    await disposeDefaultLspManager()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  }
})
