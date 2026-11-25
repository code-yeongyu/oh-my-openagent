import { afterAll, beforeAll, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { GOLDEN_CASES } from "./account-goldens.cases"
import { CANARY, type CaseRun, cleanUp, type Observed, prepareLauncher, runAll } from "./account-goldens.test-support"

// The account verbs of both editions, pinned on unmodified code before the account calls move into the core
// (#14364, slice A1b of #14943). Each case runs the real entry (the npm launcher with the service-auth bundle built
// from this source, and the OpenCode edition's CLI) against a fake account service and a fake credential store, and
// pins its exit code, stdout, stderr, the requests it sent and the devices left in the store. A case answers one golden
// (`all`) on every platform; only the `account store` switches, whose keychain exists on macOS only, keep one golden per
// platform family. OMO_RECORD_ACCOUNT_GOLDENS=1 records this platform family's entry; a recording is reviewed like code.

type Goldens = Record<string, Partial<Record<"all" | "darwin" | "other", readonly Observed[]>>>

const GOLDENS_FILE = join(import.meta.dir, "account-goldens.json")
const family = process.platform === "darwin" ? "darwin" : "other"
const recording = process.env.OMO_RECORD_ACCOUNT_GOLDENS === "1"
const goldens: Goldens = existsSync(GOLDENS_FILE) ? (JSON.parse(readFileSync(GOLDENS_FILE, "utf8")) as Goldens) : {}
let observed: ReadonlyMap<string, CaseRun> = new Map()

// Every case runs here, as shared setup: the entries are separate processes, so the whole set takes minutes on a
// loaded host while each assertion below takes none.
beforeAll(async () => {
  await prepareLauncher()
  observed = await runAll(GOLDEN_CASES)
}, 900_000)

afterAll(async () => {
  await cleanUp()
  if (!recording) return
  for (const [id, run] of observed) goldens[id] = { ...goldens[id], [family]: run.steps }
  writeFileSync(GOLDENS_FILE, `${JSON.stringify(goldens, null, 2)}\n`)
})

test.each(GOLDEN_CASES.map((golden) => [golden.id] as const))(
  "#given the account goldens #when %s runs #then its output, exit code and effects are unchanged",
  (id) => {
    const run = observed.get(id)
    expect(run?.refused).toEqual([])
    const steps = run?.steps ?? []
    for (const step of steps)
      for (const secret of Object.values(CANARY)) expect(`${step.stdout}\n${step.stderr}`).not.toContain(secret)
    if (recording) return
    expect(steps).toEqual(goldens[id]?.all ?? goldens[id]?.[family] ?? [])
  },
)
