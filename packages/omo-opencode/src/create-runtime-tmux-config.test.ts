/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
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

  describe("multiplexer env override", () => {
    test("#given OMO_TMUX_MULTIPLEXER=herdr #when runtime tmux config is created #then the backend is herdr regardless of the config chain", () => {
      expect(createRuntimeTmuxConfig({}, { OMO_TMUX_MULTIPLEXER: "herdr" } as NodeJS.ProcessEnv).multiplexer).toBe("herdr")
      expect(
        createRuntimeTmuxConfig({ tmux: { multiplexer: "tmux" } }, { OMO_TMUX_MULTIPLEXER: "herdr" } as NodeJS.ProcessEnv).multiplexer,
      ).toBe("herdr")
    })

    test("#given OMO_TMUX_MULTIPLEXER=tmux #when the config chain says herdr #then the env wins with tmux", () => {
      expect(
        createRuntimeTmuxConfig({ tmux: { multiplexer: "herdr" } }, { OMO_TMUX_MULTIPLEXER: "tmux" } as NodeJS.ProcessEnv).multiplexer,
      ).toBe("tmux")
    })

    test("#given an unrecognized override or none #when runtime tmux config is created #then the configured backend is kept", () => {
      expect(createRuntimeTmuxConfig({ tmux: { multiplexer: "herdr" } }, {}).multiplexer).toBe("herdr")
      expect(
        createRuntimeTmuxConfig({ tmux: { multiplexer: "herdr" } }, { OMO_TMUX_MULTIPLEXER: "garbage" } as NodeJS.ProcessEnv).multiplexer,
      ).toBe("herdr")
      expect(createRuntimeTmuxConfig({}, {}).multiplexer).toBe("tmux")
    })
  })

  describe("#given the runtime does not expose Bun", () => {
    test("#when interactive bash availability is checked from a bundled module #then it returns false without crashing", async () => {
      const outdir = mkdtempSync(join(tmpdir(), "omo-desktop-runtime-"))

      try {
        const build = await Bun.build({
          entrypoints: [join(import.meta.dir, "interactive-bash-availability.ts")],
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
            MODULE_PATH: join(outdir, "interactive-bash-availability.js"),
          },
          encoding: "utf8",
        })

        expect(result.stderr).toBe("")
        expect(result.status).toBe(0)
        expect(result.stdout.trim()).toBe("false")
      } finally {
        rmSync(outdir, { recursive: true, force: true })
      }
    })
  })
})
