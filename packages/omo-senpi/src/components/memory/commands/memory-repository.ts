// /memory-repository set|unset|status|push — push-only mirror configuration.
//
// Every URL that reaches the user is redacted by memory-core's MirrorSync.

import { MirrorSync } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../../extension/types"
import { parseCommandArgs } from "./args"
import { requireExistingRepo } from "./memfs-shared"
import { requireIdentity, respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"

const SUBCOMMANDS = ["set", "unset", "status", "push"] as const
const NOT_CONFIGURED = "no memory repository configured; set one with /memory-repository set <url>"

export function registerMemoryRepositoryCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("memory-repository", {
    description: "Configure the push-only mirror remote for the memory repository.",
    argumentHint: `<${SUBCOMMANDS.join("|")}> [url]`,
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const parsed = parseCommandArgs(args)
      const [subcommand, value] = parsed.positionals
      if (subcommand === undefined) {
        return respond(ctx, `usage: /memory-repository <${SUBCOMMANDS.join("|")}> [url]`, "error")
      }

      const repo = requireExistingRepo(deps, identity)
      if (typeof repo === "string") return respond(ctx, repo, "error")
      const mirror = new MirrorSync({ repo, ...(deps.exec === undefined ? {} : { exec: deps.exec }) })

      if (subcommand === "set") {
        if (value === undefined) return respond(ctx, "usage: /memory-repository set <url>", "error")
        const result = await mirror.set(value)
        const status = await mirror.status()
        const target = status.redactedUrl ?? "the configured mirror"
        return result.pushed
          ? respond(ctx, `memory repository set to ${target}; initial push succeeded`)
          : respond(
              ctx,
              `memory repository set to ${target}; initial push failed: ${result.detail}. Local commits are unaffected and every future commit retries the push.`,
              "warning",
            )
      }

      if (subcommand === "unset") {
        await mirror.unset()
        return respond(ctx, "memory repository unset; commits stay local from now on")
      }

      if (subcommand === "status") {
        const status = await mirror.status()
        if (status.url === undefined) return respond(ctx, NOT_CONFIGURED)
        const lines = [
          `# Memory repository: ${identity.identity}`,
          `Mirror: ${status.redactedUrl}`,
          `Commits ahead of mirror: ${status.aheadCount}`,
        ]
        if (status.lastLogLines.length > 0) lines.push("", "## Recent push log", ...status.lastLogLines)
        return respond(ctx, lines.join("\n"))
      }

      if (subcommand === "push") {
        const status = await mirror.status()
        if (status.url === undefined) return respond(ctx, NOT_CONFIGURED, "error")
        const result = await mirror.pushNow()
        return result.pushed
          ? respond(ctx, `pushed main to ${status.redactedUrl}`)
          : respond(ctx, `push failed: ${result.detail}`, "error")
      }

      return respond(
        ctx,
        `unknown /memory-repository subcommand: ${subcommand}; expected one of ${SUBCOMMANDS.join(", ")}`,
        "error",
      )
    },
  })
}
