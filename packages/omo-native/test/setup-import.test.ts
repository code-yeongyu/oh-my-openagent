import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  statSync, writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { teardownRoots, withDatabase } from "./teardown.test-support"

// Older Bun runtimes ship no node:sqlite at all, so the module loads lazily and the fixtures that
// need a real database skip there. Production degrades the same way: setup-import.js reports the
// database credentials as not imported when the import throws. The pinned CI runtime is now Bun
// 1.4.0, which does provide node:sqlite on Windows too, so these fixtures really open database files
// under the temp root - see teardown.test-support.ts for why teardown has to own those handles.
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
const transcripts: string[] = []
const secrets = [
  "SK-SENTINEL-DO-NOT-LOG-1", "SK-SENTINEL-DO-NOT-LOG-2",
  "SK-SENTINEL-DO-NOT-LOG-3", "SK-SENTINEL-DO-NOT-LOG-4",
]

type Fixture = { root: string; home: string; agentDir: string; xdg: string; launcher: string }

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

async function database(path: string, version: number, rows: Array<[string, string, string, string | null]>): Promise<void> {
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
    for (const [provider, type, key, disabled] of rows) {
      insert.run(provider, type, JSON.stringify({ key }), disabled)
    }
  })
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-import-"))
  roots.push(root)
  const home = join(root, "home")
  const agentDir = join(root, "senpi-agent")
  const xdg = join(root, "xdg")
  const app = join(root, "app")
  mkdirSync(home, { recursive: true })
  cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
  write(join(app, "package.json"), JSON.stringify({ name: "omo-ai", version: "test", type: "module" }))
  return { root, home, agentDir, xdg, launcher: join(app, "bin", "omo.js") }
}

function run(item: Fixture, args: string[], ttyInput?: string) {
  const before = sourceSnapshot(item)
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: item.home, USERPROFILE: item.home, SENPI_CODING_AGENT_DIR: item.agentDir,
    XDG_DATA_HOME: item.xdg,
  }
  delete env.OMO_CODING_AGENT_DIR
  delete env.PI_CODING_AGENT_DIR
  // spawnSync only returns after the child exited and was reaped, so teardown never races a live
  // child; a surfaced spawn error must fail here instead of being read as empty output.
  const result = ttyInput === undefined
    ? spawnSync(process.execPath, [item.launcher, ...args], { encoding: "utf8", env })
    : spawnSync("python3", [TTY_DRIVER, ttyInput, "[y/N]", process.execPath, item.launcher, ...args], { encoding: "utf8", env })
  if (result.error) throw result.error
  transcripts.push(`${result.stdout}${result.stderr}`)
  expectSourcesUntouched(before)
  return result
}

function auth(item: Fixture): Record<string, unknown> {
  return JSON.parse(readFileSync(join(item.agentDir, "auth.json"), "utf8"))
}

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function sourceSnapshot(item: Fixture) {
  const paths = [
    join(item.xdg, "opencode", "auth.json"),
    join(item.home, ".omp", "agent", "agent.db"),
    join(item.home, ".gjc", "agent", "agent.db"),
  ].filter(existsSync)
  return { paths, hashes: paths.map(hash) }
}

function expectSourcesUntouched(before: ReturnType<typeof sourceSnapshot>): void {
  expect(before.paths.map(hash)).toEqual(before.hashes)
  for (const path of before.paths.filter((value) => value.endsWith("agent.db"))) {
    expect(existsSync(`${path}-wal`)).toBe(false)
    expect(existsSync(`${path}-shm`)).toBe(false)
  }
}

afterEach(() => {
  try {
    for (const transcript of transcripts) {
      for (const secret of secrets) expect(transcript).not.toContain(secret)
    }
  } finally {
    // A leaking-secret assertion must not also leak the temp roots for the rest of the run.
    transcripts.length = 0
    teardownRoots(roots)
  }
})

describe("omo setup credential inheritance", () => {
  test("#given opencode api oauth mapped and gateway entries #when accepted #then only safe api ids import", () => {
    const item = fixture()
    write(join(item.xdg, "opencode", "auth.json"), JSON.stringify({
      google: { type: "api", key: secrets[0] },
      "anthropic-api": { type: "api", key: secrets[1] },
      xai: { type: "oauth", access: secrets[2] },
      opencode: { type: "api", key: secrets[3] },
      "unknown-gateway": { type: "api", key: secrets[3] },
    }))
    const before = sourceSnapshot(item)

    const result = run(item, ["setup", "--yes"])

    expect(result.status).toBe(0)
    expect(auth(item)).toEqual({
      google: { type: "api_key", key: secrets[0] },
      anthropic: { type: "api_key", key: secrets[1] },
    })
    expect(result.stdout).toContain("skipped-oauth: 1")
    expect(result.stdout).toContain("skipped-unmapped: 2")
    expect(result.stdout).toContain("xai")
    expect(result.stdout).toContain("opencode")
    expectSourcesUntouched(before)
  })

  test.skipIf(!SQLITE_AVAILABLE)("#given pinned omp and gjc databases #when accepted #then allow-listed rows import and unknown schema is noticed", async () => {
    const item = fixture()
    await database(join(item.home, ".omp", "agent", "agent.db"), 7, [["google", "api_key", secrets[0], null]])
    await database(join(item.home, ".gjc", "agent", "agent.db"), 4, [
      ["openai", "api_key", secrets[1], null],
      ["xai", "oauth", secrets[2], null],
      ["anthropic", "api_key", secrets[3], "disabled"],
    ])

    const result = run(item, ["setup", "--yes"])
    const output = `${result.stdout}${result.stderr}`

    expect(result.status).toBe(0)
    expect(output).not.toContain("could not inspect agent.db")
    expect(output).toContain("imported: 2")
    expect(existsSync(join(item.agentDir, "auth.json"))).toBe(true)
    expect(auth(item)).toEqual({
      google: { type: "api_key", key: secrets[0] },
      openai: { type: "api_key", key: secrets[1] },
    })
    const unknown = fixture()
    await database(join(unknown.home, ".omp", "agent", "agent.db"), 99, [["google", "api_key", secrets[0], null]])
    const unknownResult = run(unknown, ["setup", "--yes"])
    expect(unknownResult.status).toBe(0)
    expect(unknownResult.stdout).toContain("auth schema version 99 is unknown")
    expect(existsSync(join(unknown.agentDir, "auth.json"))).toBe(false)
  })

  test("#given an existing senpi provider #when other keys import #then its entry stays structurally byte-identical", () => {
    const item = fixture()
    const existing = { type: "api_key", key: "EXISTING-NOT-A-SENTINEL", metadata: { order: [3, 2, 1] } }
    write(join(item.agentDir, "auth.json"), JSON.stringify({ google: existing }))
    write(join(item.xdg, "opencode", "auth.json"), JSON.stringify({
      google: { type: "api", key: secrets[0] }, openai: { type: "api", key: secrets[1] },
    }))

    const result = run(item, ["setup", "--yes"])

    expect(result.status).toBe(0)
    expect(JSON.stringify(auth(item).google)).toBe(JSON.stringify(existing))
    expect(result.stdout).toContain("skipped-existing: 1")
  })

  test("#given a pre-existing auth file #when import writes #then mode backup and idempotency are exact", () => {
    const item = fixture()
    const original = '{"google":{"type":"api_key","key":"EXISTING"}}\n'
    write(join(item.agentDir, "auth.json"), original)
    chmodSync(join(item.agentDir, "auth.json"), 0o644)
    write(join(item.xdg, "opencode", "auth.json"), JSON.stringify({ openai: { type: "api", key: secrets[0] } }))

    const first = run(item, ["setup", "--yes"])
    const files = readdirSync(item.agentDir)
    const backup = files.find((name) => /^auth\.json\.bak-\d{8}T\d{6}\.\d{3}Z$/.test(name))
    expect(first.status).toBe(0)
    // Windows has no POSIX mode bits: chmod is a no-op and stat reports a default, so the 0600
    // contract is only assertable where permission bits actually exist.
    if (process.platform !== "win32") expect(statSync(join(item.agentDir, "auth.json")).mode & 0o777).toBe(0o600)
    expect(backup).toBeDefined()
    expect(readFileSync(join(item.agentDir, backup!), "utf8")).toBe(original)
    const afterFirst = readFileSync(join(item.agentDir, "auth.json"), "utf8")

    const second = run(item, ["setup", "--yes"])

    expect(second.status).toBe(0)
    expect(second.stdout).toContain("imported: 0")
    expect(readFileSync(join(item.agentDir, "auth.json"), "utf8")).toBe(afterFirst)
    expect(readdirSync(item.agentDir)).toEqual(files)
  })

  test("#given dry-run #when setup runs #then auth remains absent", () => {
    const item = fixture()
    write(join(item.xdg, "opencode", "auth.json"), JSON.stringify({ openai: { type: "api", key: secrets[0] } }))
    const result = run(item, ["setup", "--dry-run"])
    expect(result.status).toBe(0)
    expect(existsSync(join(item.agentDir, "auth.json"))).toBe(false)
    expect(`${result.stdout}${result.stderr}`).toContain("DRY RUN")
  })

  test.skipIf(process.platform === "win32")("#given declined consent #when setup runs #then auth remains absent", () => {
    const item = fixture()
    write(join(item.xdg, "opencode", "auth.json"), JSON.stringify({ openai: { type: "api", key: secrets[0] } }))
    const result = run(item, ["setup"], "n\n")
    expect(result.status).toBe(0)
    expect(existsSync(join(item.agentDir, "auth.json"))).toBe(false)
    expect(`${result.stdout}${result.stderr}`).toContain("Import cancelled")
  })

  test("#given malformed senpi auth #when accepted #then it warns and skips all writes", () => {
    const item = fixture()
    const path = join(item.agentDir, "auth.json")
    write(path, '{"google":{"key":"BROKEN"')
    write(join(item.xdg, "opencode", "auth.json"), JSON.stringify({ openai: { type: "api", key: secrets[0] } }))
    const before = readFileSync(path, "utf8")

    const result = run(item, ["setup", "--yes"])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("WARN senpi: malformed auth.json; credentials were not imported")
    expect(readFileSync(path, "utf8")).toBe(before)
  })

  test("#given detected harness models #when setup reports #then guide and catalog template are emitted without model writes", () => {
    const item = fixture()
    write(join(item.xdg, "opencode", "auth.json"), "{}")
    const result = run(item, ["setup", "--dry-run"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("docs/guide/agent-model-matching.md")
    expect(result.stdout).toContain('"models": {')
    expect(result.stdout).toContain("<custom-baseUrl-provider>/<model-id>")
    expect(existsSync(join(item.agentDir, "models.json"))).toBe(false)
  })
})

describe("omo setup import", () => {
  describe("#given no agent directory is configured", () => {
    describe("#when credentials are imported", () => {
      test("#then they land in the canonical branded directory", () => {
        const item = fixture()
        write(
          join(item.xdg, "opencode", "auth.json"),
          JSON.stringify({ google: { type: "api", key: "IMPORT-SECRET" } }),
        )
        const env: NodeJS.ProcessEnv = { ...process.env, HOME: item.home, USERPROFILE: item.home, XDG_DATA_HOME: item.xdg }
        delete env.OMO_CODING_AGENT_DIR
        delete env.SENPI_CODING_AGENT_DIR
        delete env.PI_CODING_AGENT_DIR

        const result = spawnSync(process.execPath, [item.launcher, "setup", "--yes"], { encoding: "utf8", env })

        expect(result.status).toBe(0)
        expect(existsSync(join(item.home, ".omo", "agent", "auth.json"))).toBe(true)
      })
    })
  })
})
