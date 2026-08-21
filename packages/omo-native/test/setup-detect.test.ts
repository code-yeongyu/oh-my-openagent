import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { detectHarnesses, needsSetupSuggestion } from "../bin/lib/setup-detect.js"
import { formatSetupReport } from "../bin/lib/setup-report.js"
import { teardownRoots, withDatabase } from "./teardown.test-support"

// Older Bun runtimes ship no node:sqlite at all, so the module loads lazily and the fixtures that
// need a real database skip there. Production degrades the same way: setup-detect.js falls back to
// file-presence detection when the import throws. The pinned CI runtime is now Bun 1.4.0, which does
// provide node:sqlite on Windows too, so these fixtures really open database files under the temp
// root - see teardown.test-support.ts for why teardown has to own those handles.
const SQLITE_AVAILABLE = await (async () => {
  try {
    await import("node:sqlite")
    return true
  } catch {
    return false
  }
})()

async function loadDatabaseSync() {
  const sqlite = await import("node:sqlite")
  return sqlite.DatabaseSync
}

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const TTY_DRIVER = resolve(fileURLToPath(new URL("tty-driver.py", import.meta.url)))
const roots: string[] = []
const SECRET_SENTINELS = ["SENPI-SECRET", "OPENCODE-SECRET", "SQLITE-SECRET"]

type Fixture = { root: string; home: string; agentDir: string; xdg: string }

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

async function createDatabase(path: string, version: number, rows: Array<[string, string, string | null]>): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  const DatabaseSync = await loadDatabaseSync()
  // withDatabase closes the handle on every exit path (including a throwing exec/run) and tracks it
  // for teardown, so no Windows file handle inside the temp root can outlive the fixture.
  withDatabase(new DatabaseSync(path), (db) => {
    db.exec(`
      CREATE TABLE auth_schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
      INSERT INTO auth_schema_version VALUES (1, ${version});
      CREATE TABLE auth_credentials (
        id INTEGER PRIMARY KEY, provider TEXT NOT NULL, credential_type TEXT NOT NULL,
        data TEXT NOT NULL, disabled_cause TEXT DEFAULT NULL
      );
    `)
    const insert = db.prepare("INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause) VALUES (?, ?, ?, ?)")
    for (const [provider, type, disabled] of rows) insert.run(provider, type, "SQLITE-SECRET", disabled)
  })
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-setup-"))
  roots.push(root)
  const home = join(root, "home")
  const agentDir = join(root, "senpi-agent")
  const xdg = join(root, "xdg")
  mkdirSync(home, { recursive: true })
  return { root, home, agentDir, xdg }
}

type StoreKey = "senpi" | "opencode" | "oh-my-pi" | "gajae-code"

async function populateAll(fixture: Fixture, skip?: StoreKey): Promise<void> {
  if (skip !== "senpi") write(join(fixture.agentDir, "auth.json"), JSON.stringify({
    "senpi-beta": { type: "oauth", access: "SENPI-SECRET" },
    "senpi-alpha": { type: "api_key", key: "SENPI-SECRET" },
  }))
  write(join(fixture.agentDir, "models.json"), JSON.stringify({ providers: {
    "senpi-model-b": {}, "senpi-model-a": {},
  } }))
  if (skip !== "opencode") write(join(fixture.xdg, "opencode", "auth.json"), JSON.stringify({
    "open-oauth": { type: "oauth", access: "OPENCODE-SECRET" },
    "open-api": { type: "api", key: "OPENCODE-SECRET" },
  }))
  if (skip !== "oh-my-pi") await createDatabase(join(fixture.home, ".omp", "agent", "agent.db"), 7, [
    ["omp-api", "api_key", null], ["omp-disabled", "oauth", "expired"],
  ])
  write(join(fixture.home, ".omp", "agent", "models.db"), "models-fixture")
  if (skip !== "gajae-code") await createDatabase(join(fixture.home, ".gjc", "agent", "agent.db"), 4, [
    ["gjc-oauth", "oauth", null],
  ])
  write(join(fixture.home, ".gjc", "agent", "config.yml"), [
    "modelRoles:", "  default: anthropic/fixture", "  fast: openai/fixture",
    "enabledModels:", "  - fixture-one", "  - fixture-two", "cycleOrder:", "  - default", "",
  ].join("\n"))
}

async function detect(fixture: Fixture, overrides = {}) {
  return detectHarnesses({
    home: fixture.home,
    env: { SENPI_CODING_AGENT_DIR: fixture.agentDir, XDG_DATA_HOME: fixture.xdg },
    ...overrides,
  })
}

function snapshotTree(root: string): { files: string[]; hashes: Record<string, string> } {
  const files: string[] = []
  function visit(path: string, relative = ""): void {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name)
      const name = join(relative, entry.name)
      if (entry.isDirectory()) visit(child, name)
      else files.push(name)
    }
  }
  visit(root)
  return {
    files,
    hashes: Object.fromEntries(files.map((file) => [
      file, createHash("sha256").update(readFileSync(join(root, file))).digest("hex"),
    ])),
  }
}

function createLauncherFixture(fixture: Fixture): string {
  const packageRoot = join(fixture.root, "app")
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  write(join(packageRoot, "package.json"), JSON.stringify({
    name: "omo-ai", version: "1.2.3-test.0", type: "module",
    dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
  }))
  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  write(join(senpiRoot, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi", version: "2026.8.9", type: "module", exports: { ".": "./dist/index.js" },
  }))
  write(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  write(join(senpiRoot, "dist", "cli.js"), "process.exit(0)\n")
  for (const artifact of [
    "plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js",
    "plugin/runtime/agent-toolkit/cli.js",
  ]) write(join(packageRoot, artifact), "fixture\n")
  return join(packageRoot, "bin", "omo.js")
}

function runLauncher(launcher: string, fixture: Fixture, args: string[], tty = false) {
  const env = {
    ...process.env, HOME: fixture.home, SENPI_CODING_AGENT_DIR: fixture.agentDir,
    XDG_DATA_HOME: fixture.xdg,
  }
  // spawnSync only returns after the child has exited and been reaped, so no live child owns the
  // fixture root by the time teardown runs; teardownRoots absorbs the Windows kernel lag that can
  // still keep the exited child's handles attached for a few milliseconds.
  const result = !tty
    ? spawnSync(process.execPath, [launcher, ...args], { encoding: "utf8", env })
    : spawnSync("python3", [TTY_DRIVER, "", "", process.execPath, launcher, ...args], { encoding: "utf8", env })
  if (result.error) throw result.error
  return result
}

afterEach(() => {
  teardownRoots(roots)
})

describe("omo setup sibling detection", () => {
  describe("#given all four harness stores", () => {
    test.skipIf(!SQLITE_AVAILABLE)("#when detected #then the exact report contains ids and types but no values", async () => {
      const fixture = createFixture()
      await populateAll(fixture)
      const report = formatSetupReport(await detect(fixture))
      expect(report).toBe([
        "HARNESS | INSTALLED | PROVIDERS | CREDENTIAL TYPES | MODELS",
        "senpi | yes | senpi-alpha, senpi-beta | api_key, oauth | providers: senpi-model-a, senpi-model-b",
        "opencode | yes | open-api, open-oauth | api, oauth | none",
        "oh-my-pi | yes | omp-api, omp-disabled | api_key, oauth | models.db: yes",
        "gajae-code | yes | gjc-oauth | oauth | enabledModels: fixture-one, fixture-two; modelRoles: default, fast",
        "Run `omo setup --yes` to import available API credentials.",
        "",
      ].join("\n"))
      for (const secret of SECRET_SENTINELS) expect(report).not.toContain(secret)
    })

    test.skipIf(!SQLITE_AVAILABLE)("#when detection runs twice #then every source hash and directory listing stays identical", async () => {
      const fixture = createFixture()
      await populateAll(fixture)
      const before = snapshotTree(fixture.root)
      await detect(fixture)
      await detect(fixture)
      const after = snapshotTree(fixture.root)
      expect(after).toEqual(before)
      expect(after.files.some((path) => path.endsWith("-wal") || path.endsWith("-shm"))).toBe(false)
    })
  })

  describe("#given each store is absent in turn", () => {
    test.skipIf(!SQLITE_AVAILABLE)("#when detected #then that harness reports installed no without crashing", async () => {
      const cases = [
        ["senpi", (fixture: Fixture) => join(fixture.agentDir, "auth.json")],
        ["opencode", (fixture: Fixture) => join(fixture.xdg, "opencode", "auth.json")],
        ["oh-my-pi", (fixture: Fixture) => join(fixture.home, ".omp", "agent", "agent.db")],
        ["gajae-code", (fixture: Fixture) => join(fixture.home, ".gjc", "agent", "agent.db")],
      ] as const
      for (const [name, storePath] of cases) {
        const fixture = createFixture()
        // Never create this harness's store, rather than creating it and deleting it back out.
        // Deleting was the weaker fixture: it depended on Windows releasing a just-closed SQLite
        // handle, which it refuses to do for both unlink and rename while an exited child's handle
        // lingers. "Absent" is what this test means, so build it absent.
        await populateAll(fixture, name)
        expect(existsSync(storePath(fixture))).toBe(false)
        const report = formatSetupReport(await detect(fixture))
        expect(report).toContain(`${name} | no | none | none |`)
      }
    })
  })

  describe("#given an unknown sqlite auth schema", () => {
    test.skipIf(!SQLITE_AVAILABLE)("#when detected #then it reports detection-only and parses no credentials", async () => {
      const fixture = createFixture()
      await createDatabase(join(fixture.home, ".omp", "agent", "agent.db"), 99, [["must-not-parse", "api_key", null]])
      const inventory = await detect(fixture)
      const omp = inventory.harnesses.find((item) => item.id === "oh-my-pi")!
      expect(omp.providers).toHaveLength(0)
      expect(omp.credentialTypes).toHaveLength(0)
      expect(omp.notices.join("\n")).toBe("auth schema version 99 is unknown; credentials not inspected")
    })
  })

  describe("#given node:sqlite is unavailable", () => {
    test.skipIf(!SQLITE_AVAILABLE)("#when detected #then sqlite stores degrade to file presence and remain successful", async () => {
      const fixture = createFixture()
      await populateAll(fixture)
      const inventory = await detect(fixture, { loadSqlite: async () => { throw new Error("not available") } })
      for (const id of ["oh-my-pi", "gajae-code"]) {
        const harness = inventory.harnesses.find((item) => item.id === id)!
        expect(harness.installed).toBe(true)
        expect(harness.providers).toHaveLength(0)
        expect(harness.notices.join("\n")).toBe("node:sqlite unavailable; file presence only")
      }
    })
  })

  describe("#given no credentials found and a sibling is installed", () => {
    test("#when suggestion state is checked #then only that exact condition is true", async () => {
      const fixture = createFixture()
      write(join(fixture.xdg, "opencode", "auth.json"), "{}")
      expect(needsSetupSuggestion(await detect(fixture))).toBe(true)
      write(join(fixture.agentDir, "auth.json"), JSON.stringify({ senpi: { type: "api_key", key: "SENPI-SECRET" } }))
      expect(needsSetupSuggestion(await detect(fixture))).toBe(false)
      rmSync(join(fixture.xdg, "opencode", "auth.json"))
      rmSync(join(fixture.agentDir, "auth.json"))
      expect(needsSetupSuggestion(await detect(fixture))).toBe(false)
    })

    test("#when doctor runs #then the INFO line fires only while the engine store is empty", () => {
      const fixture = createFixture()
      const launcher = createLauncherFixture(fixture)
      write(join(fixture.xdg, "opencode", "auth.json"), "{}")
      let result = runLauncher(launcher, fixture, ["doctor"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("INFO no credentials found; run omo setup to review sibling stores")
      write(join(fixture.agentDir, "auth.json"), JSON.stringify({ senpi: { type: "api_key", key: "SENPI-SECRET" } }))
      result = runLauncher(launcher, fixture, ["doctor"])
      expect(result.stdout).not.toContain("INFO no credentials found")
    })

    test.skipIf(process.platform === "win32")("#when default launch is on a TTY #then one hint appears and non-TTY emits none", () => {
      const fixture = createFixture()
      const launcher = createLauncherFixture(fixture)
      write(join(fixture.xdg, "opencode", "auth.json"), "{}")
      const nonTty = runLauncher(launcher, fixture, [])
      expect(`${nonTty.stdout}${nonTty.stderr}`).not.toContain("run `omo setup`")
      const tty = runLauncher(launcher, fixture, [], true)
      const output = `${tty.stdout}${tty.stderr}`
      expect(tty.status).toBe(0)
      expect(output.match(/sibling credentials detected; run `omo setup`/g)?.length).toBe(1)
      write(join(fixture.agentDir, "auth.json"), JSON.stringify({ senpi: { type: "api_key", key: "SENPI-SECRET" } }))
      const configured = runLauncher(launcher, fixture, [], true)
      expect(`${configured.stdout}${configured.stderr}`).not.toContain("sibling credentials detected")
    })
  })

  describe("#given malformed auth JSON", () => {
    test("#when setup runs #then it warns, exits zero, and never prints the partial value", () => {
      const fixture = createFixture()
      const launcher = createLauncherFixture(fixture)
      write(join(fixture.agentDir, "auth.json"), '{"provider":{"type":"api_key","key":"SENPI-SECRET"')
      const result = runLauncher(launcher, fixture, ["setup"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("WARN senpi: could not parse auth.json")
      expect(result.stdout).not.toContain("SENPI-SECRET")
    })
  })
})

describe("setup detection", () => {
  describe("#given credentials in the canonical branded agent directory", () => {
    describe("#when no agent directory is configured", () => {
      test("#then the canonical directory is the one detected", async () => {
        const fixture = createFixture()
        write(
          join(fixture.home, ".omo", "agent", "auth.json"),
          JSON.stringify({ "canonical-provider": { type: "api_key", key: "SENPI-SECRET" } }),
        )

        const inventory = await detectHarnesses({ home: fixture.home, env: { XDG_DATA_HOME: fixture.xdg } })

        expect(inventory.harnesses.find((harness) => harness.id === "senpi")?.providers).toContain("canonical-provider")
      })
    })
  })
})
