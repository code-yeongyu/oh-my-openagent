import { mkdirSync } from "node:fs"

import { runIncompatibilityAndEntryIsolation } from "./task-host-e2e-shards-retain-live-incompatibility.mjs"
import { runRecordedSocketMigration } from "./task-host-e2e-shards-retain-live-migration.mjs"
import {
  runRetainIdleResume,
  runRetainMidturnContinuation,
} from "./task-host-e2e-shards-retain-live-resume.mjs"
import { capture } from "./task-host-e2e-shards-retain-live-support.mjs"

export async function runRetainLiveMatrix(current, artifacts) {
  mkdirSync(artifacts, { recursive: true })
  return {
    retain_idle_resume: await capture("retain-idle-resume", artifacts, () =>
      runRetainIdleResume(current, artifacts)),
    retain_midturn_continuation: await capture("retain-midturn-continuation", artifacts, () =>
      runRetainMidturnContinuation(current, artifacts)),
    migration_recorded_socket_wins: await capture("migration-recorded-socket-wins", artifacts, () =>
      runRecordedSocketMigration(current, artifacts)),
    incompatibility_and_entry_fault_isolation: await capture(
      "incompatibility-entry-isolation",
      artifacts,
      () => runIncompatibilityAndEntryIsolation(current, artifacts),
    ),
  }
}
