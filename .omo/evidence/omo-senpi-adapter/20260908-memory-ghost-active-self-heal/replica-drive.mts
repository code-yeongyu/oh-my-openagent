
// Replica drive: patched reconcileReflectionRuns vs a byte-copy of the real wedged state of
// sisyphuslabs-d5fbf349 (active.lock restored from the pre-repair backup; runs/ + completions/
// copied from the live identity; tiny synthetic pending to prove launch promotion).
import { cp, mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"

import { buildIdentityPaths, ReflectionReservationStore, TranscriptJournal } from "@oh-my-opencode/memory-core"
import { reconcileReflectionRuns } from "../../../../packages/omo-senpi/src/components/memory/worker/run-reconciliation"

const REAL = "/Users/yeongyu/.omo/memory/agents/sisyphuslabs-d5fbf349"
const BACKUP = "/Users/yeongyu/.omo/wedge-backup-20260908/sisyphuslabs-d5fbf349"

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex")

const root = await mkdtemp(join(tmpdir(), "ghost-replica-"))
const identity = { id: "sisyphuslabs-d5fbf349", safeSlug: "sisyphuslabs-d5fbf349", paths: buildIdentityPaths(root, "sisyphuslabs-d5fbf349") }
await mkdir(identity.paths.reflection, { recursive: true })
await mkdir(join(identity.paths.reflection, "runs"), { recursive: true })
await mkdir(join(identity.paths.reflection, "completions"), { recursive: true })
await mkdir(join(root, "runtime", "dream"), { recursive: true })

await cp(`${REAL}/repo`, identity.paths.repo, { recursive: true })
await cp(`${REAL}/runtime/reflection/runs/reflection-run-1`, join(identity.paths.reflection, "runs", "reflection-run-1"), { recursive: true })
await cp(`${REAL}/runtime/reflection/completions`, join(identity.paths.reflection, "completions"), { recursive: true })
await cp(`${REAL}/runtime/dream/state.json`, join(root, "runtime", "dream", "state.json"))
await writeFile(join(identity.paths.reflection, "active.lock"), await readFile(`${BACKUP}/active.lock`, "utf8"))
await writeFile(join(identity.paths.reflection, "pending.json"), JSON.stringify({
  runId: "reflection-run-2",
  request: { trigger: "dream", origin: "shutdown", conversationIds: [], snapshots: [] },
}))

const ledgerBefore = sha(join(identity.paths.reflection, "runs", "reflection-run-1", "ledger.json"))
const finalBefore = sha(join(identity.paths.reflection, "runs", "reflection-run-1", "final.json"))
const prelaunchBefore = sha(join(identity.paths.reflection, "runs", "reflection-run-1", "prelaunch.json"))
const repoHeadBefore = (await new Response(Bun.spawn(["git", "-C", identity.paths.repo, "rev-parse", "HEAD"]).stdout).text()).trim()

const store = new ReflectionReservationStore({
  identity,
  config: { stepCount: 25, onCompaction: true },
  getJournal: async (conversationId: string) => new TranscriptJournal({ journalDir: join(identity.paths.transcripts, conversationId) }),
})
const launched: string[] = []
const results = await reconcileReflectionRuns({
  identity,
  reservation: store,
  launch: (run) => { launched.push(run.runId) },
})
const repoHeadAfter = (await new Response(Bun.spawn(["git", "-C", identity.paths.repo, "rev-parse", "HEAD"]).stdout).text()).trim()
const state = await store.readState()
const healthy = await reconcileReflectionRuns({ identity, reservation: store })

const verdict = {
  replicaRoot: root,
  results,
  launched,
  promotedActiveRunId: state.active?.runId ?? null,
  healthySecondPass: healthy,
  retiredArtifactsPreserved: {
    ledger: sha(join(identity.paths.reflection, "runs", "reflection-run-1", "ledger.json")) === ledgerBefore,
    final: sha(join(identity.paths.reflection, "runs", "reflection-run-1", "final.json")) === finalBefore,
    prelaunch: sha(join(identity.paths.reflection, "runs", "reflection-run-1", "prelaunch.json")) === prelaunchBefore,
    runDirPresent: existsSync(join(identity.paths.reflection, "runs", "reflection-run-1")),
  },
  repoHeadUnchanged: repoHeadBefore === repoHeadAfter,
}
const pass =
  results.length === 1
  && results[0]?.runId === "reflection-run-1"
  && results[0]?.outcome === "failed"
  && launched.length === 1 && launched[0] === "reflection-run-2"
  && state.active?.runId === "reflection-run-2"
  && healthy.length === 0
  && Object.values(verdict.retiredArtifactsPreserved).every(Boolean)
  && verdict.repoHeadUnchanged
console.log(JSON.stringify({ pass, ...verdict }, null, 2))
process.exit(pass ? 0 : 1)
