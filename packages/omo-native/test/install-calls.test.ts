import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setup, update } from "../bin/lib/install-calls.js"
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
