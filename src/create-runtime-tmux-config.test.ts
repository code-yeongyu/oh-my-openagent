/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TmuxConfigSchema } from "./config/schema/tmux"
import { createRuntimeTmuxConfig } from "./create-runtime-tmux-config"

describe("createRuntimeTmuxConfig", () => {
  describe("#given tmux isolation is omitted from plugin config", () => {
    test("#when runtime tmux config is created #then it matches the schema default", () => {
      const runtimeTmuxConfig = createRuntimeTmuxConfig({})
      const schemaDefault = TmuxConfigSchema.parse({}).isolation

      expect(runtimeTmuxConfig.isolation).toBe(schemaDefault)
    })
  })

  describe("#given the runtime does not expose Bun", () => {
    test("#when tmux is executable on PATH #then interactive bash availability is true", async () => {
      const outdir = mkdtempSync(join(tmpdir(), "omo-desktop-runtime-"))
      const binDir = join(outdir, "bin")

      try {
        await Bun.$`mkdir -p ${binDir}`.quiet()
        writeFileSync(join(binDir, "tmux"), "#!/bin/sh\nexit 0\n", "utf8")
        chmodSync(join(binDir, "tmux"), 0o755)
        const build = await Bun.build({
          entrypoints: [join(import.meta.dir, "create-runtime-tmux-config.ts")],
          outdir,
          target: "bun",
          format: "esm",
        })
        expect(build.success).toBe(true)

        const result = spawnSync(Bun.which("node") ?? "node", [
          "--input-type=module",
          "-e",
          `import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(process.env.MODULE_PATH).href);
console.log(String(mod.isInteractiveBashEnabled()));`,
        ], {
          env: {
            ...process.env,
            MODULE_PATH: join(outdir, "create-runtime-tmux-config.js"),
            PATH: binDir,
          },
          encoding: "utf8",
        })

        expect(result.stderr).toBe("")
        expect(result.status).toBe(0)
        expect(result.stdout.trim()).toBe("true")
      } finally {
        rmSync(outdir, { recursive: true, force: true })
      }
    })
  })
})
