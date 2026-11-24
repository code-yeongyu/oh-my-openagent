import type { ChildProcess } from "node:child_process"

import type { ManagedRunner, ManagedStartSpec } from "../../manager/types"
import type { ManagedChildHandle } from "../../manager/child-handle"
import { RunnerError } from "../in-process"
import { AcpClient, AcpRequestError, type AcpSpawnDescriptor } from "./client"
import { DevinAcpChildHandle } from "./handle"
import type { AcpConfigOption, AcpInitializeResult, AcpSessionResult, AcpServerRequest } from "./protocol"

export interface DevinAcpRunnerOptions {
  readonly env?: NodeJS.ProcessEnv
  // Binary override; falls back to DEVIN_ACP_COMMAND, then DEVIN_BIN, then `devin` on PATH.
  readonly command?: string
  readonly extraArgs?: readonly string[]
  readonly spawnChild?: (descriptor: AcpSpawnDescriptor) => ChildProcess
  readonly onWarning?: (message: string) => void
}

const AUTH_REQUIRED_CODE = -32000

/**
 * ManagedRunner that delegates a task to a local `devin acp` session: one spawned ACP agent per
 * child, prompted through session/prompt, steered by cancel+reprompt, aborted by session/cancel.
 * Devin's own subagents run inside that session and surface here as tool executions plus
 * _meta-routed updates, which the handle folds into the child's transcript events.
 *
 * Deliberately out of scope for this runner: senpi tool surfaces (toolAllowlist, memberScopedTools,
 * kernelTools, task tools), extensions, and the senpi model registry - a Devin child is a foreign
 * agent with its own tools and model catalog (`devin/<id>`), selected through the agent definition's
 * `model` or the `devin acp --model` flag.
 */
export class DevinAcpRunner implements ManagedRunner {
  readonly #options: DevinAcpRunnerOptions
  readonly #clients = new Set<AcpClient>()

  constructor(options: DevinAcpRunnerOptions = {}) {
    this.#options = options
  }

  async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const session = await this.#openSession(spec)
    const prompt = spec.instructions === undefined ? spec.prompt : `${spec.instructions}\n\n${spec.prompt}`
    session.handle.followUp(prompt)
    return session.handle
  }

  // Opens the ACP session without prompting - the paused-restore respawn path rebuilds the child so
  // a later steer delivers the next turn, never a replayed spawn prompt. Not part of ManagedRunner;
  // manager-respawn feature-detects it.
  async startSession(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    return (await this.#openSession(spec)).handle
  }

  // `sessionPath` carries the persisted ACP session id (record.child_session_id), not a file path:
  // Devin sessions live in the agent, so resume is session/load, never transcript replay.
  async resume(spec: ManagedStartSpec, sessionPath: string): Promise<ManagedChildHandle> {
    return (await this.#openSession(spec, sessionPath)).handle
  }

  async settleTeardowns(): Promise<void> {
    const clients = [...this.#clients]
    this.#clients.clear()
    await Promise.all(clients.map((client) => client.dispose().catch(() => undefined)))
  }

  async #openSession(
    spec: ManagedStartSpec,
    resumeSessionId?: string,
  ): Promise<{ readonly handle: DevinAcpChildHandle }> {
    const env = { ...(this.#options.env ?? process.env), ...(spec.memberEnv ?? {}) }
    const command =
      this.#options.command ?? env.DEVIN_ACP_COMMAND ?? env.DEVIN_BIN ?? "devin"
    const model = normalizeDevinModel(spec.model)
    const args = [
      "acp",
      ...(model === undefined ? [] : ["--model", model]),
      ...(this.#options.extraArgs ?? []),
    ]
    const descriptor: AcpSpawnDescriptor = { command, args, cwd: spec.cwd, env }

    let handle: DevinAcpChildHandle | undefined
    const client = new AcpClient(descriptor, {
      ...(this.#options.spawnChild === undefined ? {} : { spawn: this.#options.spawnChild }),
      onSessionUpdate: (params) => handle?.onSessionUpdate(params),
      onExit: () => handle?.onProcessExit(),
      onServerRequest: (request) => answerServerRequest(request),
    })
    this.#clients.add(client)

    try {
      const init = await client.initialize({
        protocolVersion: 1,
        clientInfo: { name: "omo-senpi-task", version: "0.0.0" },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          auth: { terminal: false },
          elicitation: { form: {} },
          _meta: { "cognition.ai/subagentSupport": true, "cognition.ai/messageGrouping": true },
        },
      })
      const session = await this.#openAcpSession(client, init, spec, resumeSessionId)
      const modelId = await this.#applyModel(client, session, model)
      handle = new DevinAcpChildHandle({
        taskId: spec.taskId,
        client,
        sessionId: session.sessionId,
        modelId,
      })
      client.child.once("exit", () => this.#clients.delete(client))
      return { handle }
    } catch (error) {
      this.#clients.delete(client)
      await client.dispose().catch(() => undefined)
      throw toRunnerError(error, client)
    }
  }

  async #openAcpSession(
    client: AcpClient,
    init: AcpInitializeResult,
    spec: ManagedStartSpec,
    resumeSessionId: string | undefined,
  ): Promise<AcpSessionResult & { readonly sessionId: string }> {
    const open = (): Promise<AcpSessionResult> =>
      resumeSessionId === undefined
        ? client.sessionNew({ cwd: spec.cwd, mcpServers: [] })
        : client.sessionLoad({ sessionId: resumeSessionId, cwd: spec.cwd, mcpServers: [] })
    try {
      const session = await open()
      if (session.sessionId === undefined && resumeSessionId !== undefined) {
        return { ...session, sessionId: resumeSessionId }
      }
      if (session.sessionId === undefined) {
        throw new RunnerError({
          kind: "session_unavailable",
          message: "devin acp session/new returned no sessionId",
        })
      }
      return { ...session, sessionId: session.sessionId }
    } catch (error) {
      if (!isAuthRequired(error)) throw error
      const methodId = pickAuthMethodId(init)
      if (methodId === undefined) throw error
      try {
        await client.authenticate(methodId)
      } catch (authError) {
        throw new RunnerError({
          kind: "session_unavailable",
          message: `devin acp authenticate(${methodId}) failed: ${errorMessage(authError)}`,
          cause: authError,
        })
      }
      const session = await open()
      if (session.sessionId === undefined && resumeSessionId !== undefined) {
        return { ...session, sessionId: resumeSessionId }
      }
      if (session.sessionId === undefined) {
        throw new RunnerError({
          kind: "session_unavailable",
          message: "devin acp session/new returned no sessionId",
        })
      }
      return { ...session, sessionId: session.sessionId }
    }
  }

  // Prefer the session's own reported model; when the caller named one that appears verbatim in the
  // session's model select, push it through set_config_option so --model fuzzy-matching cannot
  // silently land on a different rung.
  async #applyModel(
    client: AcpClient,
    session: AcpSessionResult & { readonly sessionId: string },
    requested: string | undefined,
  ): Promise<string> {
    const option = session.configOptions?.find((entry) => entry.id === "model")
    const reported = stringConfigValue(option?.currentValue)
    if (requested !== undefined && option !== undefined) {
      const match = configOptionMatches(option, requested)
      if (match !== undefined && reported !== match) {
        try {
          const updated = await client.sessionSetConfigOption(session.sessionId, "model", match)
          const after = updated.configOptions?.find((entry) => entry.id === "model")
          return stringConfigValue(after?.currentValue) ?? match
        } catch {
          return match
        }
      }
      if (match !== undefined) return match
    }
    return reported ?? requested ?? "unknown"
  }
}

function normalizeDevinModel(model: string | undefined): string | undefined {
  if (model === undefined) return undefined
  const trimmed = model.trim()
  if (trimmed.length === 0) return undefined
  // Agent defs and records carry senpi-style "provider/model" displays; Devin's catalog is flat, so
  // only a leading "devin/" namespace is stripped - a slash inside the id itself is left alone.
  return trimmed.startsWith("devin/") ? trimmed.slice("devin/".length) : trimmed
}

function stringConfigValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function configOptionMatches(option: AcpConfigOption, requested: string): string | undefined {
  for (const entry of option.options ?? []) {
    const value = stringConfigValue(entry.value)
    if (value === requested) return value
  }
  // Fuzzy fallback mirrors `devin acp --model`: exact id first, then case-insensitive name match.
  for (const entry of option.options ?? []) {
    const value = stringConfigValue(entry.value)
    if (value !== undefined && (entry.name === requested || value.toLowerCase() === requested.toLowerCase())) {
      return value
    }
  }
  return undefined
}

function isAuthRequired(error: unknown): boolean {
  return AcpRequestError.is(error) && error.code === AUTH_REQUIRED_CODE
}

function pickAuthMethodId(init: AcpInitializeResult): string | undefined {
  const methods = init.authMethods ?? []
  const usable = methods.filter((method) => method.type !== "env_var" && method.type !== "terminal")
  const chosen = usable[0] ?? methods[0]
  return chosen?.methodId ?? chosen?.id
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Headless task children cannot answer a human: permission prompts auto-select allow_once (never
// allow_always, which would persist rules beyond the session) and elicitation is cancelled so an
// ask_user_question surfaces as text the parent can answer through task_send instead of hanging.
async function answerServerRequest(request: AcpServerRequest): Promise<unknown> {
  switch (request.method) {
    case "session/request_permission":
      return answerPermission(request.params)
    case "elicitation/create":
    case "session/elicitation":
    case "_session/elicitation":
      return { action: "cancel" }
    default:
      throw AcpRequestError.methodNotFound(request.method)
  }
}

function answerPermission(params: unknown): unknown {
  const options = isRecord(params) && Array.isArray(params.options) ? params.options : []
  const allowOnce = options.find(
    (option) => isRecord(option) && option.kind === "allow_once" && typeof option.optionId === "string",
  )
  const fallback =
    allowOnce ??
    options.find(
      (option) =>
        isRecord(option) &&
        typeof option.kind === "string" &&
        option.kind.startsWith("allow_") &&
        typeof option.optionId === "string",
    )
  if (isRecord(fallback) && typeof fallback.optionId === "string") {
    return { outcome: { outcome: "selected", optionId: fallback.optionId } }
  }
  return { outcome: { outcome: "cancelled" } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toRunnerError(error: unknown, client: AcpClient): RunnerError {
  if (RunnerError.is(error)) return error
  const tail = client.stderrTail()
  const suffix = tail.length > 0 ? ` (stderr: ${tail.slice(-500)})` : ""
  if (error instanceof Error && error.message.includes("ENOENT")) {
    return new RunnerError({
      kind: "session_unavailable",
      message: `devin CLI not found on PATH; install it or set DEVIN_ACP_COMMAND/DEVIN_BIN${suffix}`,
      cause: error,
    })
  }
  return new RunnerError({
    kind: "session_unavailable",
    message: `devin acp session setup failed: ${errorMessage(error)}${suffix}`,
    cause: error,
  })
}

