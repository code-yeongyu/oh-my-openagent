import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { exitOf, INSTALL_UPDATE_EXITS, setup, update } from "../bin/lib/install-calls.js"
import { runSelfUpdate } from "../bin/lib/self-update.js"
import { opencodeConfigSources } from "../bin/lib/setup-opencode-assets.js"
import { REAL_SETUP_FS } from "../bin/lib/setup-fs.js"
import { setupEntryText } from "../bin/lib/setup-stream.js"
import { summaryPhrase } from "../bin/lib/setup-summary.js"

// The install namespace's bare calls (slice C1c): refusals of their own input, answered before any fetch, run or
// write; the setup value's typed fields and the phrases built from them; and the pending key never in an answer.

const CANARY = "SK-C1C-CANARY-DO-NOT-ANSWER"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setupHome(): { ports: { home: string; env: NodeJS.ProcessEnv }; authFile: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-c1c-calls-")))
  roots.push(root)
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  const source = join(root, "xdg", "opencode", "auth.json")
  mkdirSync(dirname(source), { recursive: true })
  writeFileSync(source, JSON.stringify({ google: { type: "api", key: CANARY } }))
  const env = {
    HOME: home,
    SENPI_CODING_AGENT_DIR: join(root, "agent"),
    XDG_DATA_HOME: join(root, "xdg"),
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  }
  return { ports: { home, env }, authFile: join(root, "agent", "auth.json") }
}

async function plannedSetup() {
  const fixture = setupHome()
  const planned = await setup.plan({}, fixture.ports)
  if (planned.kind !== "ok") throw new Error(`plan failed: ${JSON.stringify(planned.error)}`)
  return { ...fixture, plan: planned.value }
}

describe("install.update refuses its own input before any lookup", () => {
  test("#given an input field update does not take #then invalid_arguments names it and nothing is fetched or run", async () => {
    const calls: string[] = []
    const answer = await update({ force: true } as never, {
      fetchDistTags: () => {
        calls.push("fetch")
        return { latest: "9.9.9" }
      },
      run: async () => {
        calls.push("run")
        return { status: 0, signal: null }
      },
      readInstalled: () => {
        calls.push("read")
        return { omo: "1.0.0", engine: "1" }
      },
    })
    expect(answer).toMatchObject({ kind: "error", error: { code: "invalid_arguments", details: { field: "force" } } })
    expect(calls).toEqual([])
  })
})

describe("install_failed: one closed reason per failure, and omo update exits with the table's answer for it", () => {
  const target = { manager: "npm", command: "npm i -g omo-ai@1.0.1", argv: ["npm", "i", "-g", "omo-ai@1.0.1"] }
  const cases = [
    {
      reason: "engine_missing",
      exit: 1,
      ports: { readInstalled: () => ({ omo: "1.0.1", engine: "unknown" }) },
    },
    {
      reason: "manager_not_started",
      exit: 1,
      ports: {
        run: async () => {
          throw new Error("spawn npm ENOENT")
        },
      },
    },
    { reason: "manager_failed", exit: 3, ports: { run: async () => ({ status: 3, signal: null }) } },
    { reason: "manager_failed", exit: 1, ports: { run: async () => ({ status: null, signal: "SIGKILL" }) } },
    { reason: "not_moved", exit: 1, ports: { run: async () => ({ status: 0, signal: null }) } },
  ] as const
  for (const item of cases) {
    test(`#given a ${item.reason} update exiting ${item.exit} #then details.reason is ${item.reason} and the command exits ${item.exit}`, async () => {
      const ports = {
        resolveUpdate: () => target,
        fetchDistTags: () => ({ latest: "1.0.1" }),
        readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
        run: async () => ({ status: 0, signal: null }),
        root: "/nonexistent-omo-c1c-root",
        ...item.ports,
      }
      const answer = await update({}, ports)
      if (answer.kind !== "error" || answer.error.code !== "install_failed") throw new Error("expected install_failed")
      expect(answer.error.details).toMatchObject({ reason: item.reason })
      expect(exitOf(INSTALL_UPDATE_EXITS, answer.error)).toBe(item.exit)
      expect(await runSelfUpdate(["update"], { ...ports, log: () => {}, error: () => {} })).toBe(item.exit)
    })
  }
})

describe("install.setup.plan answers a typed failure, never a rejection", () => {
  test("#given a coverage runtime whose answer the summary cannot project #then plan answers internal_error with the cause", async () => {
    const { ports } = setupHome()
    const answer = await setup.plan(
      {},
      {
        ...ports,
        loadCoverageRuntime: async () => ({ categoryCoverage: () => ({ usable: null, unusable: null }) }),
      },
    )
    expect(answer).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    expect(JSON.stringify(answer)).not.toContain(CANARY)
  })
})

describe("install.setup.apply after a stage's write throws", () => {
  test("#given the assets stage cannot write after credentials did #then internal_error names the applied stages and the failed one", async () => {
    const fixture = setupHome()
    const config = join(fixture.ports.env.XDG_CONFIG_HOME as string, "opencode", "skills", "fixture-skill")
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, "SKILL.md"), "---\nname: fixture-skill\ndescription: d\n---\nbody\n")
    const agentDir = dirname(fixture.authFile)
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, "skills"), "not a directory\n")
    const planned = await setup.plan({}, fixture.ports)
    if (planned.kind !== "ok") throw new Error("plan failed")
    const answer = await setup.apply({ plan: planned.value, consent: "all" }, fixture.ports)
    expect(answer).toMatchObject({
      kind: "error",
      error: { code: "internal_error", details: { applied_stages: ["credentials"], failed_stage: "assets" } },
    })
    expect(existsSync(fixture.authFile)).toBe(true)
    expect(JSON.stringify(answer)).not.toContain(CANARY)
  })
})

describe("install.setup.detect and .plan read only through the named port reads and write nothing", () => {
  // The guard of the design lane's ruling: the port claims that the named reads happen, never that only they do, so
  // a read through the port of any other path throws here, as does every effect: detect and plan must still answer.
  // Each disallowed attempt is recorded before it throws, so a caller that turns the throw into a warning cannot hide it.
  const guarded = (named: ReadonlySet<string>, seen: string[], disallowed: string[]) => {
    const refuse =
      (what: string) =>
      (path: string): never => {
        disallowed.push(`${what} ${path}`)
        throw new Error(`setup wrote through ${what}`)
      }
    return {
      ...REAL_SETUP_FS,
      read: (path: string) => {
        if (!named.has(path)) {
          disallowed.push(`read ${path}`)
          throw new Error(`setup read ${path} through the port`)
        }
        seen.push(path)
        return REAL_SETUP_FS.read(path)
      },
      mkdir: refuse("mkdir"),
      writeFile: refuse("writeFile"),
      copyFile: refuse("copyFile"),
      copyTree: refuse("copyTree"),
      rename: refuse("rename"),
      remove: refuse("remove"),
      chmod: refuse("chmod"),
    }
  }

  for (const call of ["detect", "plan"] as const) {
    test(`#given only the named reads and no writes allowed #then ${call} answers and reads OpenCode's config through the port`, async () => {
      const { ports } = setupHome()
      const config = join(ports.env.XDG_CONFIG_HOME as string, "opencode", "opencode.json")
      mkdirSync(dirname(config), { recursive: true })
      writeFileSync(config, JSON.stringify({ mcp: { docs: { type: "remote", url: "https://mcp.example.test" } } }))
      const auth = join(ports.env.XDG_DATA_HOME as string, "opencode", "auth.json")
      const named = new Set([auth, ...opencodeConfigSources(ports.home, ports.env).files])
      const seen: string[] = []
      const disallowed: string[] = []
      const answer = await setup[call]({}, { ...ports, fs: guarded(named, seen, disallowed) })
      expect(answer.kind).toBe("ok")
      expect(disallowed).toEqual([])
      expect(seen).toContain(auth)
      if (call === "plan") expect(seen).toContain(config)
    })
  }
})

describe("a read that fails through the setup file port stays that file's notice", () => {
  test("#given OpenCode's auth.json and config failing to read #then detect and plan still answer and name each file", async () => {
    const { ports } = setupHome()
    const config = join(ports.env.XDG_CONFIG_HOME as string, "opencode", "opencode.json")
    mkdirSync(dirname(config), { recursive: true })
    writeFileSync(config, JSON.stringify({ mcp: {} }))
    const failing = {
      ...REAL_SETUP_FS,
      read: (path: string) => {
        throw new Error(`EACCES: permission denied, open '${path}'`)
      },
    }
    const detected = await setup.detect({}, { ...ports, fs: failing })
    if (detected.kind !== "ok") throw new Error(`detect failed: ${detected.error.code}`)
    expect(detected.value.harnesses.find((harness) => harness.id === "opencode")).toMatchObject({
      installed: true,
      notices: [expect.stringContaining("could not parse auth.json: EACCES")],
    })
    const planned = await setup.plan({}, { ...ports, fs: failing })
    if (planned.kind !== "ok") throw new Error(`plan failed: ${planned.error.code}`)
    expect(JSON.stringify(planned.value.summary.notes)).toContain(`could not parse ${config}: EACCES`)
  })
})

describe("one OpenCode config file that fails to read among readable ones", () => {
  test("#given opencode.json unreadable and opencode.jsonc readable #then plan warns about the first and keeps the second's server", async () => {
    const { ports } = setupHome()
    const dir = join(ports.env.XDG_CONFIG_HOME as string, "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "opencode.json"), "{}")
    writeFileSync(
      join(dir, "opencode.jsonc"),
      JSON.stringify({ mcp: { docs: { type: "remote", url: "https://mcp.example.test" } } }),
    )
    const unreadable = join(dir, "opencode.json")
    const fs = {
      ...REAL_SETUP_FS,
      read: (path: string) => {
        if (path === unreadable) throw new Error(`EACCES: permission denied, open '${path}'`)
        return REAL_SETUP_FS.read(path)
      },
    }
    const planned = await setup.plan({}, { ...ports, fs })
    if (planned.kind !== "ok") throw new Error(`plan failed: ${planned.error.code}`)
    expect(JSON.stringify(planned.value.summary.notes)).toContain(`could not parse ${unreadable}: EACCES`)
    expect(planned.value.stages.find((stage) => stage.id === "assets")?.entries).toContainEqual(
      expect.objectContaining({ key: "planned-mcp", value: ["docs"] }),
    )
  })
})

describe("install.setup.apply writes through the file port it is given", () => {
  test("#given a file port #then the credentials stage's write goes through it", async () => {
    const { plan, ports, authFile } = await plannedSetup()
    const writes: string[] = []
    const fs = {
      ...REAL_SETUP_FS,
      rename: (from: string, to: string) => {
        writes.push(to)
        REAL_SETUP_FS.rename(from, to)
      },
    }
    const answer = await setup.apply({ plan, consent: "all" }, { ...ports, fs })
    expect(answer).toMatchObject({ kind: "ok", value: { applied: ["credentials"] } })
    expect(writes).toEqual([authFile])
  })
})

describe("install.setup.apply refuses its own input before any write", () => {
  test("#given consent each without decide #then invalid_arguments names decide and nothing is written", async () => {
    const { plan, authFile } = await plannedSetup()
    const answer = await setup.apply({ plan, consent: "each" })
    expect(answer).toMatchObject({ kind: "error", error: { code: "invalid_arguments", details: { field: "decide" } } })
    expect(existsSync(authFile)).toBe(false)
  })

  test("#given a consent outside all and each #then invalid_arguments names consent and nothing is written", async () => {
    const { plan, authFile } = await plannedSetup()
    const answer = await setup.apply({ plan, consent: "some" as never })
    expect(answer).toMatchObject({ kind: "error", error: { code: "invalid_arguments", details: { field: "consent" } } })
    expect(existsSync(authFile)).toBe(false)
  })

  test("#given a plan this process did not answer #then invalid_arguments names plan and nothing is written", async () => {
    const { plan, authFile } = await plannedSetup()
    const answer = await setup.apply({ plan: structuredClone(plan), consent: "all" })
    expect(answer).toMatchObject({ kind: "error", error: { code: "invalid_arguments", details: { field: "plan" } } })
    expect(existsSync(authFile)).toBe(false)
  })
})

describe("install.setup.apply with consent each", () => {
  test("#given decide #then it is asked once per pending stage, before that stage writes, and its answer decides", async () => {
    const { plan, ports, authFile } = await plannedSetup()
    const asked: { id: string; written: boolean }[] = []
    const answer = await setup.apply(
      {
        plan,
        consent: "each",
        decide: (stage) => {
          asked.push({ id: stage.id, written: existsSync(authFile) })
          return "apply"
        },
      },
      ports,
    )
    expect(asked).toEqual([{ id: "credentials", written: false }])
    expect(answer).toMatchObject({ kind: "ok", value: { applied: ["credentials"], skipped: [] } })
    expect(existsSync(authFile)).toBe(true)
  })

  test("#given decide answers skip #then the stage is skipped and nothing is written", async () => {
    const { plan, ports, authFile } = await plannedSetup()
    const answer = await setup.apply({ plan, consent: "each", decide: () => "skip" }, ports)
    expect(answer).toMatchObject({ kind: "ok", value: { applied: [], skipped: ["credentials"] } })
    expect(existsSync(authFile)).toBe(false)
  })
})

describe("the setup answers carry typed fields with the phrases built from them, and never the key", () => {
  test("#given a pending key #then every phrase is its fields' phrase and the key is in no answer or event", async () => {
    const { plan, ports } = await plannedSetup()
    const parts = [...plan.summary.rows.flatMap((row) => row.parts), ...(plan.summary.coverage ?? [])]
    expect(parts.length).toBeGreaterThan(0)
    for (const part of parts) {
      for (const item of part.items) {
        const { text, ...fields } = item
        expect(text).toBe(summaryPhrase(fields))
      }
      expect(part.text).toBe(part.items.map((item: { text: string }) => item.text).join("; "))
    }
    const entries = plan.stages.flatMap((stage) => stage.entries)
    expect(entries.length).toBeGreaterThan(0)
    for (const { text, ...entry } of entries) expect(text).toBe(setupEntryText(entry))

    const events: unknown[] = []
    const applied = await setup.apply({ plan, consent: "all" }, { ...ports, onProgress: (event) => events.push(event) })
    if (applied.kind !== "ok") throw new Error("apply failed")
    for (const { text, ...entry } of applied.value.stages.flatMap((stage) => stage.entries))
      expect(text).toBe(setupEntryText(entry))
    expect(JSON.stringify([plan, applied, events])).not.toContain(CANARY)
  })
})
