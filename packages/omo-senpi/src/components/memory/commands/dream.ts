// /dream [--auto | --recent N | --conversation <ids> | --from transcript:<path>] [--to <doc>] [focus]

import { isAbsolute, relative, sep } from "node:path"

import { validateMemoryPath } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../../extension/types"
import { selectRecentDreamConversations } from "../dream-selector"
import { resolveDreamTriggerSettings } from "../dream-trigger"
import { parseCommandArgs } from "./args"
import { stageDreamTranscript } from "./dream-staging"
import {
  requireIdentity,
  respond,
  type ManualDreamCommandRequest,
  type MemoryCommandContext,
  type MemoryCommandDeps,
} from "./types"

const MODE_FLAGS = ["auto", "recent", "conversation", "from"] as const

export function registerDreamCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("dream", {
    description: "Request a manual multi-conversation memory dream run.",
    argumentHint: "[--auto | --recent N | --conversation <ids> | --from transcript:<path>] [--to <doc>] [focus]",
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")
      if (deps.dreamSink === undefined) {
        return respond(ctx, "dreaming is not available in this session; restart with memory enabled", "error")
      }

      const parsed = parseCommandArgs(args, { booleans: ["auto"] })
      const selectedModes = MODE_FLAGS.filter((flag) => parsed.flags.has(flag))
      if (selectedModes.length > 1) {
        return respond(ctx, "choose exactly one of --auto, --recent, --conversation, or --from", "error")
      }

      const focus = parsed.positionals.join(" ").trim()
      let targetDoc: string | undefined
      try {
        targetDoc = resolveTargetDoc(identity.identityPaths.repo, parsed.flags.get("to"))
      } catch (error) {
        return respond(ctx, errorMessage(error), "error")
      }

      let conversationIds: readonly string[] | undefined
      try {
        if (parsed.flags.has("recent")) {
          const recentN = positiveInteger(parsed.flags.get("recent"), "--recent")
          const settings = resolveDreamTriggerSettings(deps.loadSettings().settings, identity.identity)
          const selected = await selectRecentDreamConversations({
            transcriptsDir: identity.identityPaths.transcripts,
            currentConversationId: ctx.sessionManager?.getSessionId(),
            autoSelectMax: settings.autoSelectMax,
            autoSelectMaxBytes: settings.autoSelectMaxChars,
            now: () => new Date(deps.now?.() ?? Date.now()),
          }, recentN, { ...(focus.length === 0 ? {} : { focus }) })
          if (selected.conversationIds.length === 0) throw new TypeError("--recent found no unreflected conversations")
          conversationIds = selected.conversationIds
        } else if (parsed.flags.has("conversation")) {
          conversationIds = conversationList(parsed.flags.get("conversation"))
        } else if (parsed.flags.has("from")) {
          const source = requiredValue(parsed.flags.get("from"), "--from")
          if (!source.startsWith("transcript:") || source.slice("transcript:".length).length === 0) {
            throw new TypeError("--from expects transcript:<path> to a senpi session JSONL file")
          }
          const staged = await stageDreamTranscript(
            source.slice("transcript:".length),
            identity.identityPaths.transcripts,
            ctx.cwd ?? process.cwd(),
          )
          conversationIds = [staged.conversationId]
        }
      } catch (error) {
        return respond(ctx, errorMessage(error), "error")
      }

      const request: ManualDreamCommandRequest = {
        ...(focus.length === 0 ? {} : { focus }),
        ...(conversationIds === undefined ? {} : { conversationIds }),
        ...(targetDoc === undefined ? {} : { targetDoc }),
      }
      const outcome = await deps.dreamSink.request(request)
      if (!outcome.fired) return respond(ctx, dreamRejection(outcome.rejection), "error")
      return respond(
        ctx,
        outcome.status === "active"
          ? `dream run ${outcome.runId} reserved`
          : `dream request queued as ${outcome.runId}; another memory run is active`,
      )
    },
  })
}

function resolveTargetDoc(repoDir: string, value: string | true | undefined): string | undefined {
  if (value === undefined) return undefined
  const raw = requiredValue(value, "--to")
  if (isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    throw new TypeError("--to must be a memory-repo-relative document path")
  }
  let absolute: string
  try {
    absolute = validateMemoryPath(repoDir, raw, { fieldName: "--to", toolPath: false })
  } catch {
    throw new TypeError("--to must be a memory-repo-relative document path without traversal")
  }
  const path = relative(repoDir, absolute).split(sep).join("/")
  if (!path.endsWith(".md")) throw new TypeError("--to must target a .md document in the memory repo")
  return path
}

function positiveInteger(value: string | true | undefined, flag: string): number {
  const raw = requiredValue(value, flag)
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError(`${flag} expects a positive integer`)
  return parsed
}

function conversationList(value: string | true | undefined): string[] {
  const ids = requiredValue(value, "--conversation").split(",").map((id) => id.trim()).filter(Boolean)
  if (ids.length === 0) throw new TypeError("--conversation expects one or more comma-separated ids")
  return [...new Set(ids)]
}

function requiredValue(value: string | true | undefined, flag: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${flag} requires a value`)
  return value.trim()
}

function dreamRejection(rejection: string): string {
  if (rejection === "no_unreflected_content") return "dream found no unreflected content to process"
  if (rejection === "no_session") return "dreaming is not available without a bound memory session"
  return `dream request was not started: ${rejection}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
