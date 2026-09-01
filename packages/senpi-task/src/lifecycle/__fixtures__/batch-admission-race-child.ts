import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createTaskRecordStore } from "../../store"
import { resolveContext } from "../context"
import { admitSuspendedBatch } from "../residency"
import { FakeRegistry } from "./lifecycle-fakes"

// Child process for the two-OS-process batch admission race: builds its OWN store + context over
// the shared state dir, signals readiness, waits for the shared barrier file, then runs one batch
// admission and prints the claimed task ids as JSON on the last stdout line.
const [stateDir, parentSessionId, capRaw, barrierDir, tag] = process.argv.slice(2)

if (
  stateDir === undefined ||
  parentSessionId === undefined ||
  capRaw === undefined ||
  barrierDir === undefined ||
  tag === undefined
) {
  process.stderr.write("Expected argv: [stateDir, parentSessionId, cap, barrierDir, tag]\n")
  process.exit(1)
}

const cap = Number(capRaw)
if (!Number.isSafeInteger(cap) || cap <= 0) {
  process.stderr.write("cap must be a positive integer\n")
  process.exit(1)
}

const store = createTaskRecordStore({ project_dir: stateDir, task: { state_dir: stateDir } })
const context = resolveContext({
  store,
  registry: new FakeRegistry(),
  config: OmoTaskSettingsSchema.parse({ residency_max_children: cap }),
})

writeFileSync(join(barrierDir, `ready-${tag}`), String(process.pid))

const deadline = Date.now() + 15_000
while (!existsSync(join(barrierDir, "barrier"))) {
  if (Date.now() > deadline) {
    process.stderr.write("Timed out waiting for the barrier file\n")
    process.exit(2)
  }
  await new Promise((resolve) => setTimeout(resolve, 5))
}

const result = await admitSuspendedBatch(context, parentSessionId, {
  timing: { renewMs: 50, staleMs: 150, acquireTimeoutMs: 10_000, retryMs: 10 },
})
const claimed = result.outcomes.filter((outcome) => outcome.kind === "claimed").map((outcome) => outcome.task_id)
process.stdout.write(`${JSON.stringify({ pid: process.pid, lease: result.lease, claimed })}\n`)
process.exit(0)
