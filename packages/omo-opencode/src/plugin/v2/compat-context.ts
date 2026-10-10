import type { PluginInput } from "@opencode-ai/plugin"
import type { V2PluginContext } from "./types"
import { createV1CompatClient, type V1CompatClient } from "./client-facade"
import { warnV2Degraded } from "./degradations"
/**
 * Build a V1-shaped `PluginInput` from a V2 plugin context so the existing
 * staged init pipeline (createPluginModule().server) runs unchanged.
 *
 * V1 fields the V2 host no longer provides:
 * - `$` (BunShell): only used by session notifications, which already fall
 *   back to `child_process` when it is absent (tested behavior).
 * - `serverUrl`: the V2 plugin runs in-process with the server; the live
 *   listener route is skipped by leaving it undefined (create-managers
 *   treats `serverUrl === undefined` as "not in-process", issue #3894).
 * - `project`: synthesized from `ctx.location.project` so `worktree` and
 *   `directory` resolution keep working.
 */
export function createCompatPluginInput(v2: V2PluginContext): PluginInput & { client: V1CompatClient } {
  const directory = v2.location.directory
  const project = v2.location.project
  const worktree = project?.directory ?? directory
  const serverUrl = undefined as unknown as URL

  warnV2Degraded("ctx.$ (bun shell)", "notification runner falls back to execFile")

  // The V1 `PluginInput.client` type is the full generated SDK client with
  // union-typed request results. The facade implements only the subset OMO
  // internals actually call (audited: session get/list/create/delete/
  // messages/message/todo/abort/summarize/status/children/prompt/promptAsync,
  // tui.showToast, config.get, provider.list, app.agents/skills,
  // event.subscribe) and returns plain `{ data }` envelopes, which is the
  // shape every consumer unwraps via normalizeSDKResponse or optional
  // chaining. The double-widening through `unknown` is the sanctioned seam
  // (the V1 Desktop sidecar ships the same reduced surface), not an
  // `as any` escape.
  const client = createV1CompatClient(v2) as unknown as PluginInput["client"]
  const v1Project = {
    id: project?.id ?? "v2-project",
    vcs: "git",
    worktree,
    directory: project?.directory ?? directory,
  } as unknown as PluginInput["project"]

  const compat = {
    client,
    project: v1Project,
    directory,
    worktree,
    experimental_workspace: {
      register: () => {
        warnV2Degraded("experimental_workspace.register", "no V2 equivalent")
      },
    },
    serverUrl,
    $: undefined as unknown as PluginInput["$"],
  } as unknown as PluginInput & { client: V1CompatClient }
  return compat
}
