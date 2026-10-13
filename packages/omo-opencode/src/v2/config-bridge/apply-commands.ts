import type { V2AgentDomain, V2CommandDefinition, V2SessionDomain } from "../context-types"
import { createCommandExecutor, type BeforeCommandHook } from "./create-command-executor"
import type { DesiredConfig } from "./desired-config"

export type ApplyCommandsDeps = {
  readonly session: V2SessionDomain
  readonly agents: V2AgentDomain
  readonly beforeHook: BeforeCommandHook | undefined
}

/** Applies the desired commands inside a 2.x command transform. */
export function applyDesiredCommands(
  editor: { readonly add: (definition: V2CommandDefinition) => void },
  desired: DesiredConfig,
  deps: ApplyCommandsDeps,
): void {
  for (const [name, spec] of desired.commands) {
    editor.add({
      name,
      ...(spec.description === undefined ? {} : { description: spec.description }),
      execute: createCommandExecutor({ name, spec, session: deps.session, agents: deps.agents, beforeHook: deps.beforeHook }),
    })
  }
}
