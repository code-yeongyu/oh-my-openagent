import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { bunFormatter, createFormatterStep, detectFormatter, formatOnMutationDefaults, resolveFormatMode } from "./formatter"

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

describe("bun format in place of prettier", () => {
  const created: string[] = []
  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  // A fake bun that formats like `bun format --write <file>`: it rewrites the file only when --write is passed,
  // so a formatter entry without an in-place flag leaves the file unchanged and the test fails.
  // The plain name "bun" resolves to a decoy that does not exist, so only the exact probed path can format.
  function arrange(markers: readonly string[], bunHasFormat: boolean, languages: Record<string, boolean> = {}) {
    const cwd = mkdtempSync(join(tmpdir(), "omo-formatter-bun-"))
    created.push(cwd)
    const filePath = join(cwd, "a.ts")
    writeFileSync(filePath, "const a=1\n")
    const script = join(cwd, "fake-bun.mjs")
    writeFileSync(script, [
      'import { appendFileSync, writeFileSync } from "node:fs";',
      `appendFileSync(${JSON.stringify(join(cwd, "calls.log"))}, process.argv.slice(2).join(" ") + "\\n");`,
      'const args = process.argv.slice(2);',
      'if (args[0] === "format" && args.includes("--write")) writeFileSync(args[args.length - 1], "const a = 1;\\n");',
    ].join("\n"))
    const bin = process.platform === "win32" ? join(cwd, "bun.cmd") : join(cwd, "bun")
    if (process.platform === "win32") writeFileSync(bin, `@"${process.execPath}" "${script}" %*\r\n`)
    else {
      writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
      chmodSync(bin, 0o755)
    }
    let probes = 0
    const step = createFormatterStep({
      config: { mode: "best-effort", timeoutMs: 10_000, languages },
      markers: () => markers,
      daemonFormat: async () => ({ details: { status: "unavailable" } }),
      resolveBinary: (command) => (command === bin ? bin : command === "bun" ? join(cwd, "decoy-bun") : null),
      resolveBunFormat: async () => (probes++, bunHasFormat ? bin : undefined),
    })
    const calls = () => {
      try { return readFileSync(join(cwd, "calls.log"), "utf8").trim().split("\n").filter(Boolean) } catch { return [] }
    }
    return { cwd, filePath, step, calls, probes: () => probes }
  }

  it("#given a prettier project and a bun with format #when a file is written #then bun format rewrites it in place and says so", async () => {
    const { cwd, filePath, step, calls } = arrange([".prettierrc"], true)

    const result = await step({ toolName: "write", input: { filePath } }, cwd)

    expect(readFileSync(filePath, "utf8")).toBe("const a = 1;\n")
    expect(calls()).toEqual([`format --write ${filePath}`])
    expect(result.content?.[0]?.text).toContain("auto-formatted a.ts with bun format")
    expect(bunFormatter.args).toContain("--write")
  })

  it("#given a prettier project and a bun without format #when a file is written #then bun is never run", async () => {
    const { cwd, filePath, step, calls } = arrange([".prettierrc"], false)

    await step({ toolName: "write", input: { filePath } }, cwd)

    expect(calls()).toEqual([])
  })

  it("#given a prettier project with TypeScript formatting off #when a .ts file is written #then bun is never probed", async () => {
    const { cwd, filePath, step, calls, probes } = arrange([".prettierrc"], true, { typescript: false })

    await step({ toolName: "write", input: { filePath } }, cwd)

    expect(probes()).toBe(0)
    expect(calls()).toEqual([])
  })

  it("#given biome or no formatter config #when a file is written #then bun format is never probed", async () => {
    for (const markers of [["biome.json", ".prettierrc"], ["package.json", "bun.lock"]]) {
      const { cwd, filePath, step, calls, probes } = arrange(markers, true)

      await step({ toolName: "write", input: { filePath } }, cwd)

      expect(probes()).toBe(0)
      expect(calls()).toEqual([])
    }
  })
})
