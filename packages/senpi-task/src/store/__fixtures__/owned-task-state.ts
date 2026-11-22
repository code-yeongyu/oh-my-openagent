import { join } from "node:path"
import { loadOmoConfig, type OmoConfig, OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

// A test's task state lives inside the temp project it already owns and removes, never in the
// preload's shared agent dir: the first write there under umask 0002 leaves that dir group-writable,
// and a later RPC key probe in the same test process rejects it as unsafe_key_record (#14573).
// The path follows from the project, so a store reopened on the same project sees the same records.
export function ownedTaskStateDir(projectDir: string): string {
  return join(projectDir, ".task-state")
}

export function ownedTaskState(projectDir: string): {
  readonly project_dir: string
  readonly task: { readonly state_dir: string }
} {
  return { project_dir: projectDir, task: { state_dir: ownedTaskStateDir(projectDir) } }
}

// The project's omo.json pointed at the same owned state dir, for a production engine composed on a
// project whose records a fixture already wrote there: both must read one store.
export function ownedTaskStateConfig(projectDir: string): OmoConfig {
  const config = loadOmoConfig({ cwd: projectDir }).config
  return { ...config, task: OmoTaskSettingsSchema.parse({ ...config.task, state_dir: ownedTaskStateDir(projectDir) }) }
}
