import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { tmpdir } from "node:os"
import { join, sep, win32 } from "node:path"
import { pathToFileURL } from "node:url"

import * as bundleInputs from "./bundle-inputs.mjs"

const { BUNDLE_INPUTS_PATH, mapFromTrace, renderBundleInputs } = bundleInputs
const repoRoot = join(import.meta.dir, "..", "..", "..", "..")
const tracer = join(import.meta.dir, "bundle-inputs-trace.mjs")

// Runs one script under the trace preload in a scratch dir and returns the trace rows.
const traceScript = (runtime, files, entry) => {
  const dir = mkdtempSync(join(tmpdir(), "omo-bundle-inputs-test-"))
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true })
      writeFileSync(join(dir, name), text)
    }
    const log = join(dir, "trace.jsonl")
    const preload = runtime === "bun" ? ["--preload", tracer] : [`--import=${pathToFileURL(tracer).href}`]
    const target = typeof entry === "string" ? [join(dir, entry)] : ["-e", entry.eval(dir)]
    const result = spawnSync(runtime, [...preload, ...target], { cwd: dir, env: { ...process.env, OMO_BUNDLE_INPUTS_TRACE: log, OMO_BUNDLE_INPUTS_TMP: dir }, encoding: "utf8" })
    if (result.status !== 0) throw new Error(`${runtime} exited ${result.status}: ${result.stderr}`)
    const rows = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []
    return { rows }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// The platform form of a path with "/" separators, so the same fakes and expectations hold on win32 and POSIX.
const portable = (p) => p.split(sep).join("/")

const root = "/repo"
const existing = new Set([
  "/repo/package.json",
  "/repo/bun.lock",
  "/repo/packages/memory-core/package.json",
  "/repo/packages/memory-core/tsconfig.json",
  "/repo/packages/omo-senpi/package.json",
])
const deps = { repoRoot: root, exists: (path) => existing.has(portable(path)), realpath: (path) => path }
const row = (kind, path) => ({ kind, path })

describe("mapFromTrace", () => {
  test("keeps every traced repo file and adds the manifests that steer resolution", () => {
    const map = mapFromTrace([row("bundle", "/repo/packages/memory-core/src/a.ts"), row("read", "/repo/packages/omo-senpi/plugin/scripts/build-artifact.mjs")], deps)
    expect(map.files).toEqual([
      "package.json",
      "packages/memory-core/package.json",
      "packages/memory-core/src/a.ts",
      "packages/memory-core/tsconfig.json",
      "packages/omo-senpi/package.json",
      "packages/omo-senpi/plugin/scripts/build-artifact.mjs",
    ])
  })

  test("collapses dependency files to the lockfile and drops paths outside the repo", () => {
    const map = mapFromTrace([row("bundle", "/repo/node_modules/zod/v4/index.js"), row("read", "/tmp/omo-senpi-check/omo.js"), row("read", "/repo/.git/HEAD")], deps)
    expect(map.files).toEqual(["bun.lock", "package.json"])
  })

  test("records listed directories separately, so any file added under them counts", () => {
    const map = mapFromTrace([row("list", "/repo/packages/omo-codex/src/install"), row("list", "/elsewhere")], deps)
    expect(map.directories).toEqual(["packages/omo-codex/src/install"])
  })

  test("never lists the map itself as an input", () => {
    const map = mapFromTrace([row("read", join(root, BUNDLE_INPUTS_PATH))], deps)
    expect(map.files).not.toContain(BUNDLE_INPUTS_PATH)
  })

  test("a step whose bundler metafile went missing fails the trace instead of under-reporting", () => {
    expect(() => mapFromTrace([row("missing-metafile", "/repo/x.json")], deps)).toThrow("metafile")
  })

  test("a module load the runtime could not trace fails the trace instead of under-reporting", () => {
    expect(() => mapFromTrace([row("missing-module-hooks", "/repo/a.ts -> ./b.ts")], deps)).toThrow("module hooks")
  })
})

// Simulated win32 (no Windows host): the path module is injected, and the fakes accept only backslash paths under a drive root,
// so a POSIX-only join, relative or separator in mapFromTrace fails here on every host.
describe("mapFromTrace on win32 paths", () => {
  const winRoot = "C:\\repo"
  const winExisting = new Set(["package.json", "bun.lock", "packages/memory-core/package.json", "packages/memory-core/tsconfig.json"].map((p) => win32.join(winRoot, p)))
  const winDeps = { repoRoot: winRoot, path: win32, exists: (path) => winExisting.has(path), realpath: (path) => path }

  test("keeps backslash repo paths as portable files and finds the manifests by their backslash paths", () => {
    const map = mapFromTrace([row("bundle", win32.join(winRoot, "packages", "memory-core", "src", "a.ts"))], winDeps)
    expect(map.files).toEqual(["package.json", "packages/memory-core/package.json", "packages/memory-core/src/a.ts", "packages/memory-core/tsconfig.json"])
  })

  test("collapses node_modules to the lockfile and drops .git, the parent dir and another drive", () => {
    const map = mapFromTrace([
      row("read", win32.join(winRoot, "node_modules", "zod", "index.js")),
      row("read", win32.join(winRoot, ".git", "HEAD")),
      row("read", "C:\\elsewhere\\x.js"),
      row("read", "D:\\Temp\\omo-bundle-inputs-1\\codex\\install-local.mjs"),
      row("list", win32.join(winRoot, "packages", "omo-codex", "src", "install")),
      row("list", "D:\\Temp"),
    ], winDeps)
    expect(map.files).toEqual(["bun.lock", "package.json"])
    expect(map.directories).toEqual(["packages/omo-codex/src/install"])
  })
})

// A bundling step whose bun build call the trace failed to recognise writes no bundle rows; the map would
// silently lose the bundler's whole source list.
describe("bundling steps", () => {
  test("every recipe step is marked as bundling", () => {
    expect(bundleInputs.RECIPE.map((step) => [step.name, step.bundles])).toEqual(bundleInputs.RECIPE.map((step) => [step.name, true]))
  })

  test("a bundling step that recorded no bundle rows fails the trace, naming the step", () => {
    const step = { name: "build-install --check", bundles: true }
    const rows = bundleInputs.checkStepRows(step, [row("read", "/repo/packages/omo-senpi/package.json")])
    expect(() => mapFromTrace(rows, deps)).toThrow("build-install --check")
  })

  test("a bundling step with bundle rows passes", () => {
    const step = { name: "build-install --check", bundles: true }
    const rows = bundleInputs.checkStepRows(step, [row("bundle", "/repo/packages/memory-core/src/a.ts")])
    expect(mapFromTrace(rows, deps).files).toContain("packages/memory-core/src/a.ts")
  })
})

// guards: `bun install` runs `prepare` (= `bun run build` over script/build-nodes.ts), so anything that chain reaches runs on
// every install; the trace there hung Windows installs for the whole job timeout. The trace runs only from the explicit
// `bundle-inputs` regen script and CI's `bundle-inputs:check` step, never from an install, build or test chain.
describe("package.json build scripts", () => {
  const scripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts

  // Every root script reachable from `names` through `bun run <script>` references, the named ones included.
  const reachable = (names) => {
    const seen = new Set()
    const walk = (name) => {
      if (seen.has(name) || scripts[name] === undefined) return
      seen.add(name)
      for (const match of scripts[name].matchAll(/\bbun run ([\w:.-]+)/g)) walk(match[1])
    }
    for (const name of names) walk(name)
    return [...seen]
  }

  test("no script reachable from an install, build or test chain runs the trace", () => {
    const names = reachable(["prepare", "build", "build:senpi-plugin", "build:senpi-plugin:stage", "build:senpi-plugin:native", "test:senpi"])
    expect(names).toContain("build:senpi-plugin:stage")
    expect(names.filter((name) => scripts[name].includes("bundle-inputs.mjs"))).toEqual([])
  })

  test("no script/build-nodes.ts node reaches the trace through package.json", async () => {
    const { BUILD_NODES } = await import(join(repoRoot, "script", "build-nodes.ts"))
    const senpi = BUILD_NODES.find((node) => node.id === "senpi-plugin")
    expect(senpi.args).toEqual(["run", "build:senpi-plugin:stage"])
    for (const node of BUILD_NODES) {
      expect(node.args.join(" ")).not.toContain("bundle-inputs.mjs")
      const roots = node.command === "bun" && node.args[0] === "run" ? [node.args[1]] : []
      expect(reachable(roots).filter((name) => scripts[name].includes("bundle-inputs.mjs"))).toEqual([])
    }
  })

  test("the trace has its own regen and check scripts", () => {
    expect(scripts["bundle-inputs"]).toBe("node packages/omo-senpi/plugin/scripts/bundle-inputs.mjs")
    expect(scripts["bundle-inputs:check"]).toBe("node packages/omo-senpi/plugin/scripts/bundle-inputs.mjs --check")
  })
})

// guards: a fail-closed backstop for the rule above. Bun and npm set npm_lifecycle_event for lifecycle scripts; under an
// install lifecycle the script refuses before any recipe step runs (no scratch dir, no generator spawned).
describe("under an install lifecycle", () => {
  for (const lifecycle of ["prepare", "postinstall", "install"]) {
    test(`refuses to trace when npm_lifecycle_event=${lifecycle}`, () => {
      const tmp = mkdtempSync(join(tmpdir(), "omo-bundle-inputs-lifecycle-"))
      try {
        const result = spawnSync("node", [join(import.meta.dir, "bundle-inputs.mjs"), "--check"], {
          cwd: repoRoot,
          env: { ...process.env, npm_lifecycle_event: lifecycle, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
          encoding: "utf8",
          timeout: 20000,
        })
        expect(result.status).not.toBe(0)
        expect(result.status).not.toBeNull()
        expect(result.stderr).toContain(`bundle-inputs: refusing to trace during '${lifecycle}'`)
        expect(readdirSync(tmp)).toEqual([])
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
})

// A caller's environment (build:omo-native sets OMO_SENPI_PLUGIN_OUTPUT=<buildRoot>/plugin) or a developer shell must
// not steer the traced generators at a staged copy outside the repo: those reads would drop out of the map.
describe("the recipe environment", () => {
  const scripts = readdirSync(import.meta.dir).filter((name) => name.endsWith(".mjs") && !name.includes(".test"))
  const knobs = new Set(scripts.flatMap((name) => readFileSync(join(import.meta.dir, name), "utf8").match(/\bOMO_[A-Z0-9_]*(?:OUTPUT|TARGET|ENTRY|DIST)\b/g) ?? []))

  test("drops every output-steering knob the recipe scripts read", () => {
    const scratch = join(tmpdir(), "omo-bundle-inputs-scratch")
    const base = Object.fromEntries([...knobs, "OMO_SENPI_STAGE_FAIL_AFTER_BACKUP"].map((key) => [key, "/elsewhere/plugin"]))
    const env = bundleInputs.recipeEnv(scratch, { ...base, PATH: "/bin" })
    expect(bundleInputs.SCRUBBED_ENV).toContain("OMO_SENPI_PLUGIN_OUTPUT")
    for (const key of bundleInputs.SCRUBBED_ENV) expect(env[key]).toBeUndefined()
    for (const key of knobs) expect(env[key] === undefined || env[key].startsWith(scratch)).toBe(true)
    expect(env.PATH).toBe("/bin")
    expect(env.OMO_BUNDLE_INPUTS_TRACE).toBe(join(scratch, "trace.jsonl"))
  })
})

describe("the trace preload", () => {
  test("records a recursive cp source as a listed directory", () => {
    const { rows } = traceScript("node", {
      "src/a.txt": "a",
      "main.mjs": `import { cpSync } from "node:fs"\ncpSync(new URL("./src", import.meta.url), new URL("./out", import.meta.url), { recursive: true })\n`,
    }, "main.mjs")
    const src = rows.filter((r) => portable(r.path).endsWith("/src"))
    expect(src.map((r) => r.kind)).toEqual(["list"])
  })

  test("under bun, which has no module hooks, a module importing another module fails the trace", () => {
    const { rows } = traceScript("bun", {
      "dep.mjs": "export const x = 1\n",
      "lib.mjs": `import { x } from "./dep.mjs"\nexport const y = x\n`,
      "main.mjs": `import { y } from "./lib.mjs"\nif (y !== 1) process.exit(1)\n`,
    }, "main.mjs")
    expect(rows.some((r) => r.kind === "missing-module-hooks")).toBe(true)
  })

  // The Codex step's shape: `bun -e` importing the generator, which imports builtins only.
  test("under bun -e, the entry's own import is recorded as a module, not a failure", () => {
    const { rows } = traceScript("bun", {
      "gen.mjs": `import { readFile } from "node:fs/promises"\nexport const run = () => readFile(new URL(import.meta.url))\n`,
    }, { eval: (dir) => `const m = await import(${JSON.stringify(pathToFileURL(join(dir, "gen.mjs")).href)}); await m.run()` })
    expect(rows.filter((r) => r.kind === "missing-module-hooks")).toEqual([])
    expect(rows.some((r) => r.kind === "module" && portable(r.path).endsWith("/gen.mjs"))).toBe(true)
  })

  // build-install spawns bun with shell: true on win32, which joins argv unquoted.
  test("under a shell spawn, a metafile path with spaces stays one argument", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-bundle-inputs-test-"))
    try {
      const scratch = join(dir, "with space")
      mkdirSync(scratch)
      writeFileSync(join(dir, "entry.mjs"), "export const x = 1\n")
      writeFileSync(join(dir, "main.mjs"), `import { spawnSync } from "node:child_process"\nconst r = spawnSync("bun", ["build", "entry.mjs", "--outfile", "out.js"], { shell: true, stdio: "ignore" })\nprocess.exit(r.status ?? 1)\n`)
      const log = join(dir, "trace.jsonl")
      const result = spawnSync("node", [`--import=${pathToFileURL(tracer).href}`, join(dir, "main.mjs")], { cwd: dir, env: { ...process.env, OMO_BUNDLE_INPUTS_TRACE: log, OMO_BUNDLE_INPUTS_TMP: scratch }, encoding: "utf8" })
      expect(result.status).toBe(0)
      const rows = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
      expect(rows.filter((r) => r.kind === "missing-metafile")).toEqual([])
      expect(rows.some((r) => r.kind === "bundle" && r.path.endsWith("entry.mjs"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("under bun, a step that imports only builtins traces cleanly", () => {
    const { rows } = traceScript("bun", { "main.mjs": `import { readFile } from "node:fs/promises"\nawait readFile(new URL(import.meta.url))\n` }, "main.mjs")
    expect(rows.filter((r) => r.kind === "missing-module-hooks")).toEqual([])
    expect(rows.some((r) => r.kind === "read" && r.path.endsWith("main.mjs"))).toBe(true)
  })
})

// The Codex step runs under bun, where module loads and named node:fs sync imports are not traced.
// The map is complete only while the Codex script imports builtins alone and reads through fs/promises.
describe("script/build-codex-install.ts", () => {
  const source = readFileSync(join(repoRoot, "script", "build-codex-install.ts"), "utf8")
  const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)].map((m) => m[1])

  // guards: the Codex step's trace completeness (bun has no load hooks, so only builtin imports are safe).
  test("imports builtins only, so the bun trace sees every file it reads", () => {
    expect(imports.length).toBeGreaterThan(0)
    const builtins = new Set(builtinModules)
    expect(imports.filter((s) => !(s.startsWith("node:") || builtins.has(s)))).toEqual([])
    expect(imports).not.toContain("node:fs")
    expect(imports).not.toContain("fs")
  })
})

describe("the committed map", () => {
  const committed = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", BUNDLE_INPUTS_PATH), "utf8"))

  test("is rendered in canonical form", () => {
    expect(readFileSync(join(import.meta.dir, "..", "..", "..", "..", BUNDLE_INPUTS_PATH), "utf8")).toBe(renderBundleInputs(committed))
  })

  // The bundle marker hashes the build scripts next to the sources (build-artifact.mjs digestBuildSources),
  // so a comment-only edit to either changes every header: both must be inputs.
  // guards: the trace sees the header-digest reads, so the merge gate counts a build-script edit as a bundle change.
  test("covers the files every bundle header hashes", () => {
    for (const path of [
      "packages/omo-senpi/plugin/scripts/build-artifact.mjs",
      "packages/omo-senpi/plugin/scripts/build-extension-core.mjs",
      "packages/omo-senpi/src/extension/bundled-index.ts",
      "packages/omo-senpi/src/install/cli-local.ts",
      "script/build-codex-install.ts",
    ]) expect(committed.files).toContain(path)
  })
})
