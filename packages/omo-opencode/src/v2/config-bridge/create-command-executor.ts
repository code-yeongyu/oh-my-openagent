import type { V2AgentDomain, V2CommandInvocation, V2ModelRef, V2SessionDomain } from "../context-types"
import { renderCommandTemplate } from "./render-command-template"

export type CommandSpec = {
  readonly template: string
  readonly description?: string
  readonly agent?: string
  readonly model?: string
}

export type CommandPart = { type: string; text?: string; [key: string]: unknown }

/** The plugin's 1.x `command.execute.before` hook, which 2.x has no global counterpart for. */
export type BeforeCommandHook = (
  input: { command: string; sessionID: string; arguments: string },
  output: { parts: CommandPart[] },
) => Promise<void>

export type CommandExecutorDeps = {
  readonly name: string
  readonly spec: CommandSpec
  readonly session: V2SessionDomain
  readonly agents: V2AgentDomain
  readonly beforeHook: BeforeCommandHook | undefined
}

function parseModel(model: string | undefined): V2ModelRef | undefined {
  if (model === undefined || !/^[^/#]+\/[^#]+(?:#[^#]+)?$/.test(model)) return undefined
  const separator = model.indexOf("/")
  const rest = model.slice(separator + 1)
  const hash = rest.indexOf("#")
  return {
    providerID: model.slice(0, separator),
    id: hash === -1 ? rest : rest.slice(0, hash),
    ...(hash === -1 ? {} : { variant: rest.slice(hash + 1) }),
  }
}

/**
 * Runs a command on 2.x the way 1.x did: render the template, let the plugin's
 * `command.execute.before` hook rewrite the parts, then send the text as a prompt (after switching
 * agent and model when the command names them: a model named by the command wins, otherwise the
 * named agent's own model, as the 2.x host does for its template commands). If the hook leaves no
 * text, nothing is sent.
 */
export function createCommandExecutor(deps: CommandExecutorDeps): (invocation: V2CommandInvocation) => Promise<void> {
  return async (invocation) => {
    const argumentText = invocation.prompt.text
    const parts: CommandPart[] = [{ type: "text", text: renderCommandTemplate(deps.spec.template, argumentText) }]
    await deps.beforeHook?.({ command: deps.name, sessionID: invocation.sessionID, arguments: argumentText }, { parts })
    const text = parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n")
    if (text.trim().length === 0) return
    const agentName = deps.spec.agent
    if (agentName !== undefined) {
      const current = await deps.session.get({ sessionID: invocation.sessionID })
      if (current.agent !== agentName) await deps.session.switchAgent({ sessionID: invocation.sessionID, agent: agentName })
    }
    const agentModel =
      agentName === undefined || deps.spec.model !== undefined
        ? undefined
        : (await deps.agents.list()).data.find((agent) => agent.id === agentName)?.model
    const model = parseModel(deps.spec.model) ?? agentModel
    if (model !== undefined) await deps.session.switchModel({ sessionID: invocation.sessionID, model })
    await deps.session.prompt({ sessionID: invocation.sessionID, text, delivery: invocation.delivery })
  }
}
