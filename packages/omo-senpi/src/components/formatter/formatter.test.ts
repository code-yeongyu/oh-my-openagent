import { describe, expect, it } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createFormatterStep, detectFormatter, formatOnMutationDefaults, resolveFormatMode } from "./formatter"

describe("format-on-mutation policy", () => {
  it("uses marker precedence and never enables prettier beside biome", () => {
    expect(detectFormatter(["biome.json", ".prettierrc"], "src/a.ts")?.tool).toBe("biome")
    expect(detectFormatter([".prettierrc"], "src/a.ts")?.tool).toBe("prettier")
    expect(detectFormatter(["Cargo.toml"], "src/a.rs")?.tool).toBe("rustfmt")
    expect(detectFormatter(["go.mod"], "src/a.go")?.tool).toBe("gofmt")
    expect(detectFormatter(["pyproject.toml"], "src/a.py", "[tool.ruff]\nline-length=88")?.tool).toBe("ruff")
    expect(detectFormatter(["pyproject.toml"], "src/a.py", "[tool.black]\nline-length=88")).toBeUndefined()
  })

  it("has the required defaults and language overrides", () => {
    expect(formatOnMutationDefaults).toEqual({ mode: "best-effort", maxFileBytes: 1048576, timeoutMs: 3000 })
    expect(resolveFormatMode({ mode: "required", languages: { typescript: false } }, "typescript")).toBe("off")
    expect(resolveFormatMode({}, "python")).toBe("best-effort")
    expect(resolveFormatMode({ mode: "required" }, "python")).toBe("required")
  })

  it("contains machine-readable change notice tokens", () => {
    const notice = "(OmO) auto-formatted src/a.ts with biome (+1/-2 lines). File content changed; re-read before exact-text edits."
    expect(notice).toContain("auto-formatted")
    expect(notice).toContain("re-read before exact-text edits")
  })
})

describe("formatter CLI fallback when the binary cannot be spawned", () => {
  // node_modules/.bin ships an extensionless POSIX shim that Windows cannot execute, so the
  // CLI fallback regularly hits a child that fails to spawn. That must degrade, not crash.
  function arrange(fileName: string) {
    const cwd = mkdtempSync(join(tmpdir(), "omo-formatter-"))
    const filePath = join(cwd, fileName)
    writeFileSync(filePath, "const a=1\n")
    const warnings: string[] = []
    return {
      cwd,
      filePath,
      warnings,
      step: (mode: "best-effort" | "required") =>
        createFormatterStep({
          config: { mode, timeoutMs: 1_000 },
          markers: () => [".prettierrc"],
          daemonFormat: async () => ({ details: { status: "unavailable" } }),
          resolveBinary: () => join(cwd, "node_modules", ".bin", "prettier"),
          logger: { warn: (message: string) => void warnings.push(message) },
        }),
    }
  }

  it("#given an unspawnable formatter binary #when a mutation is formatted #then it degrades instead of throwing", async () => {
    const { cwd, filePath, warnings, step } = arrange("best-effort.ts")

    const result = await step("best-effort")({ toolName: "write", input: { filePath } }, cwd)

    expect(result.error).toBeUndefined()
    expect(result.content).toBeUndefined()
    expect(warnings).toEqual(["Formatter prettier unavailable; install it with bun add -d"])
  })

  it("#given required mode #when the formatter binary cannot be spawned #then the failure is reported as unavailable", async () => {
    const { cwd, filePath, step } = arrange("required.ts")

    const result = await step("required")({ toolName: "write", input: { filePath } }, cwd)

    expect(result.error).toContain("Formatter prettier is unavailable")
  })
})
