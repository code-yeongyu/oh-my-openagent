import {
  runParentSuccessorScenario,
} from "./task-host-e2e-shards-handoff-successors-live.mjs"
import { runInteractiveSuccessorScenario } from "./task-host-e2e-shards-handoff-successors-interactive.mjs"
import {
  runAltRootSuccessorScenario,
} from "./task-host-e2e-shards-handoff-successors-alt.mjs"
import { runNestedResumeScenario } from "./task-host-e2e-shards-handoff-successors-resume.mjs"

export async function runHandoffSuccessorMatrix(current, olderBin, artifacts) {
  return {
    handoff_nested_spawn_uses_successor:
      await runParentSuccessorScenario(current, olderBin, artifacts),
    interactive_handoff_nested_spawn:
      await runInteractiveSuccessorScenario(current, olderBin, artifacts),
    alt_root_handoff_parent_and_thread:
      await runAltRootSuccessorScenario(current, olderBin, artifacts),
    nested_resume_attach_only:
      await runNestedResumeScenario(current, artifacts),
  }
}
