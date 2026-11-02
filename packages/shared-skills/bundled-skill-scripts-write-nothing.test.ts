import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, win32 } from "node:path"
import { materializeFrontendRefs } from "./scripts/materialize-frontend-refs.mjs"
import { createSkillSourceCopyFilter } from "./skill-source-filter.mjs"

// Package contract (#11373): the skills tree ships inside the signed desktop app bundle, so running
// any bundled script must leave that tree byte-identical. A stray __pycache__ breaks the code
// signature and the desktop stops its servers. The copy stays writable on purpose: the installed
// bundle is writable by its owner, and CPython silently skips bytecode writes into a read-only
// directory, which would hide the defect. Script entries run WITHOUT -B (an agent may drop the flag),
// so each must set sys.dont_write_bytecode itself; `python -m` entries run with -B as documented,
// because the interpreter compiles the package before any of its code can set the flag. Test
// modules are not skill entries and are left out. Only entries that load sibling code can write
// bytecode, so those are the ones run, and each must exit 0: a script that stops before its sibling
// import (an old interpreter, a crash) would otherwise pass without proving anything.

const skillsRoot = join(import.meta.dir, "skills")
const python = process.platform === "win32" ? "python" : "python3"
const workRoot = mkdtempSync(join(tmpdir(), "omo-skill-writes-"))
const shippedRoot = join(workRoot, "skills")
const pythonEnv: Record<string, string | undefined> = { ...process.env }
delete pythonEnv.PYTHONDONTWRITEBYTECODE
delete pythonEnv.PYTHONPYCACHEPREFIX

beforeAll(() => {
  cpSync(skillsRoot, shippedRoot, { recursive: true, filter: createSkillSourceCopyFilter(skillsRoot) })
  materializeFrontendRefs({ targetRoot: join(shippedRoot, "frontend") })
})

afterAll(() => {
  rmSync(workRoot, { recursive: true, force: true })
})

function changedSince(before: Map<string, string>): string[] {
  const after = listTree(shippedRoot)
  return [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key)).sort()
}

function listTree(root: string, relativePath = relative): Map<string, string> {
  const entries = new Map<string, string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const key = relativePath(root, path).replaceAll("\\", "/")
      if (entry.isDirectory()) {
        entries.set(`${key}/`, "dir")
        walk(path)
      } else {
        entries.set(key, createHash("sha256").update(readFileSync(path)).digest("hex"))
      }
    }
  }
  walk(root)
  return entries
}

type PythonEntry = { cwd: string; argv: string[] }

function moduleEntry(path: string, tree: Map<string, string>, root: string, relativePath: typeof relative): PythonEntry | undefined {
  const parts = [basename(path, ".py")]
  let dir = dirname(path)
  while (tree.has(relativePath(root, join(dir, "__init__.py")).replaceAll("\\", "/"))) {
    parts.unshift(basename(dir))
    dir = dirname(dir)
  }
  if (parts.length === 1) return undefined
  if (parts.at(-1) === "__main__") parts.pop()
  return { cwd: dir, argv: ["-B", "-m", parts.join("."), "--help"] }
}

function loadsSiblingCode(path: string, tree: Map<string, string>, root: string, relativePath: typeof relative): boolean {
  const dir = relativePath(root, dirname(path)).replaceAll("\\", "/")
  const source = readFileSync(path, "utf8")
  for (const match of source.matchAll(/^\s*(?:from|import)\s+(\w+)|run_module\(\s*["'](\w+)/gm)) {
    const name = match[1] ?? match[2] ?? ""
    if (tree.has(`${dir}/${name}.py`) || tree.has(`${dir}/${name}/__init__.py`)) return true
  }
  return false
}

function pythonEntries(root: string, relativePath = relative): PythonEntry[] {
  const tree = listTree(root, relativePath)
  const found: PythonEntry[] = []
  for (const [key] of tree) {
    if (!key.endsWith(".py") || key.split("/").includes("tests")) continue
    const path = join(root, key)
    if (!/__name__\s*==\s*["']__main__["']/.test(readFileSync(path, "utf8")) && basename(path) !== "__main__.py") continue
    const skillDir = join(root, key.split("/")[0] ?? "")
    const asModule = moduleEntry(path, tree, root, relativePath)
    if (asModule) found.push(asModule)
    else if (loadsSiblingCode(path, tree, root, relativePath)) found.push({ cwd: skillDir, argv: [relativePath(skillDir, path).replaceAll("\\", "/"), "--help"] })
  }
  return found
}

describe("bundled skill scripts", () => {
  test("#given Windows relative paths #when building script entries #then every recorded path uses forward slashes", () => {
    // given
    const root = join(workRoot, "entry fixtures")
    const scripts = join(root, "fixture", "scripts")
    const pkg = join(root, "fixture", "pkg")
    mkdirSync(scripts, { recursive: true })
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(scripts, "helper.py"), "")
    writeFileSync(join(scripts, "entry.py"), 'import helper\nif __name__ == "__main__": pass\n')
    writeFileSync(join(scripts, "entry.sh"), "")
    writeFileSync(join(scripts, "entry.mjs"), "")
    writeFileSync(join(pkg, "__init__.py"), "")
    writeFileSync(join(pkg, "__main__.py"), "")

    // when
    const tree = listTree(root, win32.relative)
    const entries = pythonEntries(root, win32.relative)

    // then
    expect([...tree.keys()].sort()).toEqual([
      "fixture/", "fixture/pkg/", "fixture/pkg/__init__.py", "fixture/pkg/__main__.py",
      "fixture/scripts/", "fixture/scripts/entry.mjs", "fixture/scripts/entry.py", "fixture/scripts/entry.sh", "fixture/scripts/helper.py",
    ])
    expect(entries.sort((left, right) => left.argv.join(" ").localeCompare(right.argv.join(" ")))).toEqual([
      { cwd: join(root, "fixture"), argv: ["-B", "-m", "pkg", "--help"] },
      { cwd: join(root, "fixture"), argv: ["scripts/entry.py", "--help"] },
    ])
  })

  test("#given the test interpreter #when checked #then it meets the bundled scripts' Python 3.11 floor", async () => {
    const child = Bun.spawn([python, "-c", "import sys; print(sys.version_info >= (3, 11))"], { stdout: "pipe", stderr: "ignore" })
    expect((await new Response(child.stdout).text()).trim()).toBe("True")
  })

  test("#given the shipped skills tree #when every bundled Python entry runs #then the tree stays byte-identical", async () => {
    // given
    const before = listTree(shippedRoot)
    const entries = pythonEntries(shippedRoot)
    expect(entries.map((entry) => entry.argv.join(" "))).toContain("scripts/find-agent-sessions.py --help")

    // when
    const exits = await Promise.all(
      entries.map(async (entry) => {
        const child = Bun.spawn([python, ...entry.argv], { cwd: entry.cwd, env: pythonEnv, stdout: "ignore", stderr: "pipe", timeout: 30_000 })
        const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
        return { entry: entry.argv.join(" "), code, stderr: code === 0 ? "" : stderr.slice(-400) }
      }),
    )

    // then
    expect(exits.filter((result) => result.code !== 0)).toEqual([])
    expect(changedSince(before)).toEqual([])
  }, 120_000)

  test("#given a synthetic session store #when find-agent-sessions really searches it #then it finds the session and the tree stays byte-identical", async () => {
    // given
    const home = join(workRoot, "home")
    mkdirSync(join(home, ".claude", "transcripts"), { recursive: true })
    const row = { sessionId: "fixture-11373", type: "user", timestamp: "2026-10-26T00:00:00Z", cwd: home, content: "needle-11373 bundle check" }
    writeFileSync(join(home, ".claude", "transcripts", "fixture-11373.jsonl"), `${JSON.stringify(row)}\n`)
    const env = { ...pythonEnv, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: join(home, ".cache"), XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share") }
    const before = listTree(shippedRoot)

    // when
    const child = Bun.spawn([python, "scripts/find-agent-sessions.py", "find", "needle-11373", "--platform", "claude", "--limit", "5"], {
      cwd: join(shippedRoot, "coding-agent-sessions"),
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    })
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])

    // then
    expect(exitCode).toBe(0)
    expect(stdout).toContain("fixture-11373")
    expect(changedSince(before)).toEqual([])
  }, 120_000)
})
