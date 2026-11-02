import { afterEach, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"

const bundle = fileURLToPath(new URL("../../../../plugin/runtime/agent-toolkit-sdk/sdk.js", import.meta.url))
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

for (const sessionId of ["worker-session", undefined]) {
  test(`#given an isolated built SDK and session=${sessionId} #when a worker imports and calls it #then only session cwd is used`, async () => {
    const root = mkdtempSync(join(tmpdir(), "sdk-worker-"))
    roots.push(root)
    const cwd = join(root, "workspace")
    mkdirSync(cwd)
    const sdkPath = join(root, "sdk.mjs")
    copyFileSync(bundle, sdkPath)
    expect(existsSync(join(root, "node_modules"))).toBe(false)
    const source = readFileSync(sdkPath, "utf8")
    const imports = [...source.matchAll(/\b(?:import|export)\s*(?:[^"'()]*?\bfrom\s*)?["']([^"']+)["']/g)].map(match => match[1])
    expect(imports.length).toBeGreaterThan(0)
    expect(imports.filter(value => !value?.startsWith("node:"))).toEqual([])
    const script = join(root, "worker.mjs")
    writeFileSync(script, `import { parentPort } from 'node:worker_threads';
      import { pathToFileURL } from 'node:url';
      ${sessionId === undefined ? "delete process.env.PI_SESSION_ID" : `process.env.PI_SESSION_ID = ${JSON.stringify(sessionId)}`};
      process.env.PI_SESSION_CWD = ${JSON.stringify(cwd)};
      delete process.env.PI_GOAL_STORE_FILE;
      const { agentToolkit } = await import(pathToFileURL(${JSON.stringify(sdkPath)}).href);
      parentPort.postMessage({ status: await agentToolkit.status(), created: await agentToolkit.createGoals({ brief: '- worker goal' }) });`)
    const worker = new Worker(script)
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("worker result timeout")), 10_000)
        worker.once("message", value => { clearTimeout(timeout); resolve(value) })
        worker.once("error", error => { clearTimeout(timeout); reject(error) })
        worker.once("exit", code => { if (code !== 0) { clearTimeout(timeout); reject(new Error(`worker exit ${code}`)) } })
      })
      if (sessionId === undefined) {
        expect(result).toMatchObject({ status: { ok: false, error: { code: "ULW_LOOP_SESSION_ID_REQUIRED" } }, created: { ok: false } })
        expect(readdirSync(cwd)).toEqual([])
      } else {
        expect(result).toMatchObject({ status: { ok: false }, created: { ok: true } })
        expect(existsSync(join(cwd, ".omo", "ulw-loop", sessionId, "goals.json"))).toBe(true)
      }
    } finally { await worker.terminate() }
  })
}
