import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const runner = fileURLToPath(new URL("./run-all.mjs", import.meta.url))

describe("thread QA summary counters", () => {
  test("#given scenario SKIP and DEFECT output #when reports are optional #then the summary and visible output stay the same", () => {
    const root = mkdtempSync(join(tmpdir(), "thread-qa-summary-test-"))
    try {
      const senpiRoot = join(root, "senpi")
      const desktopRoot = join(root, "desktop")
      for (const path of [
        join(senpiRoot, "packages/coding-agent/scripts/qa-app-server/lib/env.mjs"),
        ...["ai", "agent", "tui"].map((name) => join(senpiRoot, "packages", name, "dist/index.js")),
        join(desktopRoot, "node_modules/effect/package.json"),
      ]) {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, "{}")
      }
      mkdirSync(join(senpiRoot, "node_modules"))
      const preload = join(root, "scenario-output.mjs")
      writeFileSync(preload, `
        import { writeFileSync } from "node:fs";
        const text = "SKIP synthetic/check\\nDEFECT synthetic/problem\\nPASS synthetic/cleanup-no-leftovers\\n";
        Bun.spawnSync = (args, options) => {
          const out = args.indexOf("--out");
          if (out !== -1) writeFileSync(args[out + 1], text);
          if (options.stdout === "inherit") process.stdout.write(text);
          return { exitCode: 0, stdout: options.stdout === "pipe" ? Buffer.from(text) : undefined };
        };
      `)
      for (const reportArgs of [[], ["--out-dir", join(root, "reports")]]) {
        const child = Bun.spawnSync([process.execPath, "--preload", preload, runner, "--suite", "legacy", ...reportArgs], {
          env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root, THREAD_QA_SENPI_ROOT: senpiRoot, THREAD_QA_DESKTOP_ROOT: desktopRoot },
          stdout: "pipe",
          stderr: "pipe",
          timeout: 10_000,
        })
        const stdout = new TextDecoder().decode(child.stdout)
        expect({ exitCode: child.exitCode, stderr: new TextDecoder().decode(child.stderr) }).toEqual({ exitCode: 0, stderr: "" })
        const summary = stdout.split("\n").find((line) => line.startsWith("PASS run-all "))
        const counters = Object.fromEntries([...summary.matchAll(/(\w+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)]))
        expect(counters).toEqual({ failed_scenarios: 0, skipped_scenarios: 0, skipped_checks: 6, product_defects: 6 })
        expect(stdout).toContain("SKIP synthetic/check\n")
        expect(readdirSync(root).filter((name) => name.startsWith("thread-qa-reports-"))).toEqual([])
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
