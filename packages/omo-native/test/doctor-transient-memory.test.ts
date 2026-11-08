import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { countTransientMemoryIdentities, formatTransientMemoryLines } from "../bin/lib/doctor.js"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(path: string, content = "fixture\n"): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

describe("omo doctor transient memory identities", () => {
  test("#given identity directories with and without repo/ #when counted #then only the repo-less ones are transient", () => {
    const dirs: Record<string, string[]> = {
      "/memory/agents": ["durable-a", "durable-b", "transient-a", "transient-b", "transient-c"],
      "/memory/transient-runs": ["aaa-1-zz", "bbb-2-zz"],
    }
    const counts = countTransientMemoryIdentities({
      agentsRoot: "/memory/agents",
      transientRoot: "/memory/transient-runs",
      listDirs: (path: string) => dirs[path],
      hasRepo: (path: string) => path.includes("durable"),
    })

    expect(counts).toEqual({ durable: 2, transient: 3, runs: 2 })
  })

  test("#given no memory root on disk #when counted #then the report stays silent instead of inventing zeros", () => {
    const counts = countTransientMemoryIdentities({
      agentsRoot: "/nowhere/agents",
      transientRoot: "/nowhere/transient-runs",
      listDirs: () => undefined,
      hasRepo: () => false,
    })

    expect(counts).toBeUndefined()
    expect(formatTransientMemoryLines(counts)).toEqual([])
  })

  test("#given a counted memory root #when formatted #then one INFO line reports the transient count", () => {
    expect(formatTransientMemoryLines({ durable: 46, transient: 475, runs: 2 })).toEqual([
      "INFO memory identities: 46 durable, 475 transient (no repo/); transient run roots: 2",
    ])
  })

  test("#given a memory root holding dead transient identities #when doctor runs #then the transient count is reported", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-doctor-transient-"))
    roots.push(root)
    const packageRoot = join(root, "app")
    mkdirSync(packageRoot, { recursive: true })
    cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
    writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "omo-ai",
      version: "1.2.3-test.0",
      type: "module",
      dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
    }))
    const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
    writeFile(join(senpiRoot, "package.json"), JSON.stringify({
      name: "@code-yeongyu/senpi",
      version: "2026.8.9",
      type: "module",
      exports: { ".": "./dist/index.js" },
    }))
    writeFile(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
    writeFile(join(senpiRoot, "dist", "cli.js"), "process.exit(0)\n")
    writeFile(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
    for (const artifact of [
      "plugin/package.json",
      "plugin/extensions/omo.js",
      "plugin/runtime/lsp-daemon/dist/cli.js",
      "plugin/runtime/agent-toolkit/cli.js",
    ]) writeFile(join(packageRoot, artifact))

    const memoryHome = join(root, "memory")
    writeFile(join(memoryHome, "agents", "durable-1", "repo", "system", "persona.md"))
    writeFile(join(memoryHome, "agents", "transient-1", "runtime", "locks", ".keep"))
    writeFile(join(memoryHome, "agents", "transient-2", "runtime", "locks", ".keep"))
    writeFile(join(memoryHome, "transient-runs", "aaa-1-zz", "agents", "x", "runtime", "locks", ".keep"))

    const result = spawnSync(process.execPath, [join(packageRoot, "bin", "omo.js"), "doctor"], {
      encoding: "utf8",
      env: {
        ...process.env,
        SENPI_CODING_AGENT_DIR: join(root, "agent"),
        OMO_MEMORY_HOME: memoryHome,
      },
    })

    expect(result.stdout).toContain("INFO memory identities: 1 durable, 2 transient (no repo/); transient run roots: 1")
    expect(result.stdout).not.toContain("FAIL")
  })
})
