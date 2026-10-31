import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PROBE_REQUEST_EVENT, withProbeRequestExtension } from "./probe-request"

test("a probe-only RPC extension announces the actual request once, including without omo loaded", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "request-extension-"))
  try {
    const spec = { task_id: "probe", cwd: stateDir, state_dir: stateDir, prompt: "test" }
    expect(withProbeRequestExtension(spec)).toBe(spec)
    const probed = withProbeRequestExtension({ ...spec, probeProviderRequest: true })
    const path = probed.extensions?.[0]
    if (path === undefined) throw new Error("missing request extension")
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const extension = await import(path)
    let request: (() => void) | undefined
    const emitted: string[] = []
    extension.default({
      on: (event: string, handler: () => void) => {
        expect(event).toBe("before_provider_request")
        request = handler
      },
      rpc: { emit: (name: string) => { emitted.push(name) } },
    })
    expect(emitted).toEqual([])
    expect(request).toBeDefined()
    request?.()
    request?.()
    expect(emitted).toEqual([PROBE_REQUEST_EVENT])
  } finally { rmSync(stateDir, { recursive: true, force: true }) }
})
