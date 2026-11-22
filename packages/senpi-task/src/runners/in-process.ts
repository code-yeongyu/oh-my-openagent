import type { CreateAgentSessionOptions, ToolDefinition } from "@code-yeongyu/senpi"

import type { ResolvedModelRecord } from "../state"
import type { KernelToolBindingRegistry } from "../kernel-tools/bindings"
import type { KernelToolGrant } from "../kernel-tools/resolve"
import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import type { ChildDialogForwarder } from "./child-dialogs/forwarder"
import { isWorkpoolYieldTool } from "../workpool/worker-tool-identity"
import {
  createRestoredChildHandle,
  createStagedChildHandle,
  discardUnstartedChildSession,
  type ChildHandle,
  type ChildCompletionPolicy,
  type ChildSession,
} from "./in-process/child-handle"
import {
  buildChildSessionOptions,
  requireChildSessionDir,
  resolveMemberScopedToolNames,
} from "./in-process/child-options"
import {
  defaultCreateChildSession,
  type ChildDialogBinding,
  type CreateChildSession,
} from "./in-process/create-child-session"
import { assertPinnedModelHonoured } from "./in-process/pin-check"
import { assertUsableSessionFile } from "./in-process/session-file-guard"
import { RunnerError } from "./in-process/runner-error"
import type { ChildRetryOverride } from "./in-process/runtime-fallback-settings"
import { buildSubagentPrompt } from "./in-process/subagent-prompt"

export type {
  ChildHandle,
  ChildCompletionPolicy,
  ChildSession,
  ChildSessionEvent,
  ChildSessionListener,
  QueuedInputDisposition,
  RunnerFailure,
  RunnerOutcome,
} from "./in-process/child-handle"
export type { ChildRetryOverride } from "./in-process/runtime-fallback-settings"
export {
  childVisibleToolNames,
  filterSharedParentTools,
  isTaskOrTeamFamilyTool,
  mergeChildCustomTools,
  type SharedToolFilterOptions,
} from "./in-process/shared-tool-filter"
export { RunnerError } from "./in-process/runner-error"

export const DEFAULT_MAX_CHILD_DEPTH = 4

export type StagedInProcessChild = {
  readonly handle: ChildHandle
  readonly promptText: string
  begin(): void
}

export type DepthPolicy = {
  readonly maxDepth: number
}

// Per-child construction spec. `model`, `authStorage`, `modelRegistry` reuse senpi's own option
// types so the parent's auth/models resolve normally against the parent's real agentDir.
export type ChildSpec = {
  readonly taskId: string
  readonly cwd: string
  // Isolated persistence dir for the child's JSONL transcript:
  // resolveChildSessionDir(join(stateDir, "children", taskId), taskId), shared with the rpc mode so
  // reconcile's newestSessionPath discovers both modes identically. REQUIRED - a missing dir is a
  // typed session-create-failed, never a silent inMemory/default-dir fallback.
  readonly sessionDir: string
  readonly agentDir?: string
  // The parent session's project-trust decision. The child's settings include the project layer
  // only when the parent trusted it; unknown means untrusted.
  readonly projectTrusted?: boolean
  readonly authStorage?: CreateAgentSessionOptions["authStorage"]
  readonly modelRegistry?: CreateAgentSessionOptions["modelRegistry"]
  readonly modelRuntime?: CreateAgentSessionOptions["modelRuntime"]
  readonly model?: CreateAgentSessionOptions["model"]
  readonly thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"]
  readonly selectedModel?: string
  readonly requestedModel?: ResolvedModelRecord
  readonly fallbackModels?: readonly ResolvedModelRecord[]
  readonly resolvedModel?: ResolvedModelRecord
  /**
   * Same-model retry budget merged over the engine defaults. A child racing a short deadline uses
   * it so the runtime reaches `fallbackModels` in seconds instead of spending the default
   * exponential same-model backoff first. Absent keeps the engine default for every existing caller.
   */
  readonly retry?: ChildRetryOverride
  readonly toolAllowlist?: readonly string[]
  // Denylist mapped onto senpi's real deny field `excludeTools` (`tools:` is the allowlist and does
  // NOT deny). Sourced from record.tool_deny (the agent definition's disallowedTools).
  readonly toolDenylist?: readonly string[]
  // Ordinary task children match process mode's nested task/workpool surface. DAG/workpool/member
  // children leave this false and retain the stricter orchestration exclusion.
  readonly includeTaskTools?: boolean
  // Names of the member-scoped tools, carried for persistence so a later resume can re-resolve
  // them against the live shared parent tools (todo 10). Start uses `memberScopedTools` directly.
  readonly memberScopedToolNames?: readonly string[]
  // executable ToolDefinitions merged AFTER the shared-tool family filter - the ONLY sanctioned
  // bypass of the task/team-family exclusion (team layer injects the pre-scoped member tool here).
  readonly memberScopedTools?: readonly ToolDefinition[]
  /**
   * TRANSIENT parent kernel-tool grant for THIS process only: live capability plus the fenced
   * descriptors resolved at spawn. It is never persisted - SpawnSpecV1, the JSONL session_init and
   * the task record carry no closure, descriptor or requested name (see buildSpawnSpecV1).
   */
  readonly kernelTools?: KernelToolGrant
  readonly depth: number
  readonly parentSessionId: string
  readonly rootSessionId: string
  // An engine-owned worker (the facts extractor) whose parent ids name its run, not a live session. It opens without
  // spawnedBy and without a preset flag, so its preset is the one the engine's own resolver gives its settings (senpi
  // rule 4), never inherited and never loosened; `allowTools` (its own task tools only) run without asking, and every
  // other gated call is decided by that preset as usual.
  readonly ownApprovalMode?: { readonly allowTools: readonly string[] }
  readonly agentType?: string
  readonly instructions?: string
  readonly prompt: string
  /**
   * System prompt that REPLACES senpi's default for this child: the minimal child loader returns
   * it from getSystemPrompt(), and senpi's session construction uses a loader prompt INSTEAD of
   * its dynamic default. Absent keeps the engine default for every existing caller.
   */
  readonly systemPrompt?: string
  /**
   * How `prompt` is delivered. "subagent" (the default) wraps it in the task ancestry envelope;
   * "bare" passes it VERBATIM as the initial user message - for children whose prompt is a
   * self-contained data block that must not be prefixed with "You are running as an omo
   * senpi-task child" lines (the kibitzer judge persona/payload split).
   */
  readonly promptEnvelope?: "subagent" | "bare"
  /**
   * How the settled turn is judged: final-text (default) requires assistant text, turn treats any normally settled turn as completion - for tool-only children whose deliverable is a side effect.
   */
  readonly completion?: ChildCompletionPolicy
}

export type { CreateChildSession } from "./in-process/create-child-session"

export type InProcessRunnerOptions = {
  // The parent extension's registered ToolDefinitions (same-process, same execute closures). The
  // task/team family and any UI-rendering-only names are excluded before reaching a child.
  readonly sharedParentTools?: readonly ToolDefinition[]
  readonly uiOnlyToolNames?: Iterable<string>
  readonly depthPolicy?: DepthPolicy
  readonly createSession?: CreateChildSession
  /**
   * The parent engine's runtime kernel-tool map. The runner binds a granted child here at spawn so
   * a SAME-host revive can reach the same live parent closures; a new host process has no map entry
   * and the revived child fails closed instead.
   */
  readonly kernelToolBindings?: KernelToolBindingRegistry
  // The parent's UI for the child's select/confirm/input/editor (#6189 F2d); absent, the child has no UI.
  readonly dialogs?: ChildDialogForwarder
}

export class InProcessRunner {
  readonly #sharedParentTools: readonly ToolDefinition[]
  readonly #uiOnlyToolNames: readonly string[]
  readonly #depthPolicy: DepthPolicy
  readonly #createSession: CreateChildSession
  readonly #kernelToolBindings: KernelToolBindingRegistry | undefined
  readonly #dialogs: ChildDialogForwarder | undefined

  constructor(options: InProcessRunnerOptions = {}) {
    this.#dialogs = options.dialogs
    this.#sharedParentTools = options.sharedParentTools ?? []
    this.#uiOnlyToolNames = [...(options.uiOnlyToolNames ?? [])]
    this.#depthPolicy = options.depthPolicy ?? { maxDepth: DEFAULT_MAX_CHILD_DEPTH }
    this.#createSession = options.createSession ?? defaultCreateChildSession
    this.#kernelToolBindings = options.kernelToolBindings
  }

  #dialogBinding(taskId: string): ChildDialogBinding | undefined {
    return this.#dialogs === undefined ? undefined : { forwarder: this.#dialogs, taskId }
  }

  async start(spec: ChildSpec): Promise<ChildHandle> {
    const staged = await this.startStaged(spec)
    staged.begin()
    return staged.handle
  }

  // Create the child session without sending its first prompt; `begin` sends it.
  async startStaged(spec: ChildSpec): Promise<StagedInProcessChild> {
    if (spec.depth > this.#depthPolicy.maxDepth) {
      throw new RunnerError({
        kind: "depth-exceeded",
        message: `Child depth ${spec.depth} exceeds max depth ${this.#depthPolicy.maxDepth}.`,
      })
    }

    let session: ChildSession
    let createdSession: ChildSession | undefined
    try {
      // SessionManager and the child option helpers below read barrel values synchronously, so the
      // barrel is loaded here (memoized: a cache hit in any process that already runs the engine).
      const { SessionManager } = await loadSenpiBarrel()
      const options = buildChildSessionOptions({
        spec,
        sessionManager: SessionManager.create(
          spec.cwd,
          requireChildSessionDir(spec),
          spec.ownApprovalMode !== undefined
            ? {}
            : {
                spawnedBy: {
                  parentSessionId: spec.parentSessionId,
                  rootSessionId: spec.rootSessionId,
                  taskId: spec.taskId,
                },
              },
        ),
        sharedParentTools: this.#sharedParentTools,
        uiOnlyToolNames: this.#uiOnlyToolNames,
        ...(this.#kernelToolBindings === undefined ? {} : { kernelToolBindings: this.#kernelToolBindings }),
      })
      session = await this.#createSession(options, this.#dialogBinding(spec.taskId))
      createdSession = session
      assertPinnedModelHonoured(spec, session)
    } catch (error) {
      // A start that never produced a session must leave NO binding behind: the runner floor refuses
      // curated/policy-narrowed/colliding grants by throwing from here, and a stale entry would keep
      // a strong reference to the parent kernel until TTL expunge.
      this.#kernelToolBindings?.release(spec.taskId)
      // A session that WAS created but failed the pin check is disposed here (session_shutdown +
      // dispose): no handle exists yet, so nobody else owns that teardown (#9722 M1). A teardown
      // that itself fails still escapes as a typed RunnerError - never an untyped AggregateError.
      if (createdSession !== undefined) {
        try {
          await discardUnstartedChildSession(createdSession)
        } catch (shutdownError) {
          throw new RunnerError({
            kind: "model_unavailable",
            message: "the pin check failed, and shutting down its session failed",
            cause: new AggregateError([error, shutdownError]),
          })
        }
      }
      if (RunnerError.is(error)) throw error
      throw new RunnerError({ kind: "session-create-failed", message: sessionCreateMessage(error), cause: error })
    }

    // The bare envelope is the opt-out from the subagent ancestry wrapper: the spec's prompt is the
    // whole user message, byte-identical. Every other value (including undefined) wraps it in the
    // task envelope, which is what all existing callers rely on.
    const promptText =
      spec.promptEnvelope === "bare"
        ? spec.prompt
        : buildSubagentPrompt({
            taskId: spec.taskId,
            parentSessionId: spec.parentSessionId,
            rootSessionId: spec.rootSessionId,
            depth: spec.depth,
            prompt: spec.prompt,
            ...(spec.agentType !== undefined && { agentType: spec.agentType }),
            ...(spec.instructions !== undefined && { instructions: spec.instructions }),
          })

    let staged: { readonly handle: ChildHandle; begin(): void }
    try {
      staged = createStagedChildHandle({
        taskId: spec.taskId,
        session,
        promptText,
        ...(spec.completion === undefined ? {} : { completion: spec.completion }),
      })
    } catch (error) {
      this.#kernelToolBindings?.release(spec.taskId)
      await discardUnstartedChildSession(session).catch((shutdownError: unknown) => {
        throw new AggregateError(
          [error, shutdownError],
          "child handle construction failed, and shutting down its session failed",
        )
      })
      throw error
    }
    // Runtime-only, and only once the child actually exists: the grant is bound under this child's
    // id for same-host revival. Nothing about it reaches the record, the v1 spawn_spec or the
    // child's JSONL transcript.
    if (spec.kernelTools !== undefined) this.#kernelToolBindings?.bind(spec.taskId, spec.kernelTools)
    return { handle: staged.handle, promptText, begin: staged.begin }
  }

  // Rebuild a persisted child from its session transcript WITHOUT replaying its prompt. The tool
  // surface is reconstructed through the SAME option builder as start: member-scoped tool names
  // are re-resolved against the live shared parent tools (any executable memberScopedTools on the
  // spec are discarded - persisted/executable tools are untrusted), the curated read-only bash
  // override is reinstalled, and the denylist is re-applied via excludeTools, so a resumed child
  // never comes back with a WIDER tool surface than it had. The restored handle is IDLE; any
  // continuation nudge is manager-owned (todo 12), never sent here.
  async resume(spec: ChildSpec, sessionPath: string): Promise<ChildHandle> {
    const yields = (spec.memberScopedTools ?? []).filter(isWorkpoolYieldTool)
    const memberScopedTools = resolveMemberScopedToolNames(spec.memberScopedToolNames ?? [], [
      ...this.#sharedParentTools.filter((tool) => tool.name !== "workpool"),
      ...yields,
    ])
    assertUsableSessionFile(sessionPath)

    let session: ChildSession
    try {
      const { SessionManager } = await loadSenpiBarrel()
      // Parent kernel tools are NOT rebuilt from the spec: only a runtime binding that survived
      // same-host parking can restore a callable tool, and a missing binding restores typed error
      // stubs from this child's own recorded transcript names.
      const { kernelTools: _discardedGrant, ...plain } = spec
      const options = buildChildSessionOptions({
        spec: { ...plain, memberScopedTools },
        sessionManager: SessionManager.open(sessionPath, requireChildSessionDir(spec), spec.cwd),
        sharedParentTools: this.#sharedParentTools,
        uiOnlyToolNames: this.#uiOnlyToolNames,
        revivedSessionPath: sessionPath,
        ...(this.#kernelToolBindings === undefined ? {} : { kernelToolBindings: this.#kernelToolBindings }),
      })
      session = await this.#createSession(options, this.#dialogBinding(spec.taskId))
    } catch (error) {
      if (RunnerError.is(error)) throw error
      throw new RunnerError({ kind: "session_unavailable", message: sessionResumeMessage(error), cause: error })
    }

    return createRestoredChildHandle({
      taskId: spec.taskId,
      session,
      ...(spec.completion === undefined ? {} : { completion: spec.completion }),
    })
  }
}

function sessionCreateMessage(error: unknown): string {
  return `Failed to create in-process child session: ${error instanceof Error ? error.message : String(error)}`
}

function sessionResumeMessage(error: unknown): string {
  return `Failed to resume in-process child session: ${error instanceof Error ? error.message : String(error)}`
}
