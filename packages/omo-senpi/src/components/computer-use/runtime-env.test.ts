import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import { createComputerUseRuntime } from "./runtime"

test.each([false, true])("#given configured overrides=%s #when parent environment changes before engine startup #then unconfigured engines inherit the current value", async (configured) => {
  // given
  const root = mkdtempSync(join(tmpdir(), "omo-runtime-env-"))
  const entry = join(root, "engine.ts")
  const executable = join(root, process.platform === "win32" ? "engine.exe" : "engine")
  const receipt = join(root, "env.json")
  const fixture = resolve(import.meta.dir, "../../../../senpi-desktop-service/test/fake-engine.mjs")
  writeFileSync(entry, `import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ display: process.env.DISPLAY }));
    await import(${JSON.stringify(fixture)});`)
  const before = process.env.DISPLAY
  let runtime: ReturnType<typeof createComputerUseRuntime> | undefined
  try {
    const build = await Bun.build({ entrypoints: [entry], compile: { outfile: executable } })
    if (!build.success) throw new Error(build.logs.map((log) => log.message).join("\n"))
    process.env.DISPLAY = ":before"
    runtime = createComputerUseRuntime({
      settings: resolveComputerSettings({ enginePath: executable, ...(configured ? { env: { DISPLAY: ":configured" } } : {}) }),
      executeTool: async () => ({ content: [] }),
      onEngineError: () => {},
    })
    // when
    process.env.DISPLAY = ":after"
    await runtime.service.open({})
    // then
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({ display: configured ? ":configured" : ":after" })
  } finally {
    await runtime?.service.close()
    if (before === undefined) delete process.env.DISPLAY
    else process.env.DISPLAY = before
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
