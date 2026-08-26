// Cold-boot probe for the senpi-barrel warm-up on the DAG run-creation path (issue #7339).
//
// Executed by manager-cold-barrel.test.ts in a FRESH bun process on purpose: both bunfig test
// preloads (root test-setup.ts and packages/senpi-task/test-support/warm-lazy-runtime.ts) call
// loadSenpiBarrel() before any test body runs, so an in-process probe would pass regardless of the
// fix. `bun run` ignores `[test] preload`, so the barrel starts genuinely cold here.
//
// The scenario: dag start materializes node skills at run creation through the default filesystem
// skill loader, whose discovery reads senpiBarrel().loadSkillsFromDir SYNCHRONOUSLY. Nothing on
// that path used to await loadSenpiBarrel(), so a definition with load_skills crashed the start
// call with "The @code-yeongyu/senpi barrel was accessed before it was loaded" before any worker
// was dispatched. The skill name below deliberately resolves to NO file: directSkill() misses in
// every searched dir, forcing discoveredSkill() to invoke the barrel-backed discovery - exactly
// the sync read that must be preceded by an awaited barrel load.
import { mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { senpiBarrel } from "../../lazy/senpi-barrel"
import { createDagManager } from "../manager"
import { createDagSkillMaterializer } from "../skills"
import { createDagFileStore } from "../store"
import type { DagDefinition } from "../graph"

type ProbeResult = {
  readonly coldBeforeStart: boolean
  readonly started: boolean
  readonly missingSkillReported: boolean
  readonly error?: string
}

function definition(): DagDefinition {
  return {
    key: "barrel-probe",
    name: "barrel probe",
    nodes: [
      { id: "only", prompt: "draft the plan", category: "quick", load_skills: ["no-such-skill-anywhere"] },
    ],
  }
}

async function main(): Promise<ProbeResult> {
  // Proves the process really started cold; without this the "started" assertion could be
  // satisfied by an unnoticed preload rather than by the manager's own warm-up.
  let coldBeforeStart = false
  try {
    senpiBarrel()
  } catch {
    coldBeforeStart = true
  }

  const project = mkdtempSync(join(tmpdir(), "omo-7339-dag-probe-"))
  // The one EXISTING skill search dir: discovery runs over it (and finds nothing), so the
  // barrel-backed discover closure is actually invoked instead of being skipped by existsSync.
  mkdirSync(join(project, ".senpi", "skills"), { recursive: true })

  const store = createDagFileStore({ project_dir: project })
  const materializeSkills = createDagSkillMaterializer({ store, cwd: project, homeDir: project })
  const dag = createDagManager({ store, materializeSkills })

  try {
    const started = await dag.start({
      definition: definition(),
      parentSessionId: "probe-session",
      rootSessionId: "probe-session",
    })
    const record = dag.record(started.snapshot.runId, "probe-session")
    return {
      coldBeforeStart,
      started: true,
      missingSkillReported: record.diagnostics.some(
        (diagnostic) => diagnostic.kind === "missing_skill" && diagnostic.skill === "no-such-skill-anywhere",
      ),
    }
  } catch (error) {
    return {
      coldBeforeStart,
      started: false,
      missingSkillReported: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

console.log(JSON.stringify(await main()))
