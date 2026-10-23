// /agreements: the person's own surface over system/agreements.md. It is the only writer that may
// create, reword, acknowledge, or drop an item written by the person (`by: human`); automation is
// refused those edits by memory-core's agreements guard.

import { join } from "node:path"

import { mkdir, writeFile } from "@oh-my-opencode/memory-core/fs"
import {
  AGREEMENTS_PATH,
  ackAgreement,
  addHumanAgreement,
  agreementItemsOf,
  agreementTextProblem,
  cleanAgreementText,
  commitMemoryWrite,
  createLockRecord,
  dropAgreement,
  memoryWriterLockPath,
  readAgreementsWorktree,
  renderAgreementsFile,
  strippedLegacyUserHeader,
  sortAgreements,
  withLock,
  type AgreementItem,
  type GitMemoryRepo,
  type MemoryWriteLock,
} from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../../extension/types"
import { hasGitRepo, openRepo } from "./repo"
import { requireIdentity, respond, sessionIdOf, type MemoryCommandContext, type MemoryCommandDeps, type MemoryCommandIdentity } from "./types"

const USAGE = "usage: /agreements [list] | add [--project] <agreement> | ack <id> | drop <id>"

export function registerAgreementsCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("agreements", {
    description: "List, add, acknowledge, or drop your standing agreements with the agent.",
    argumentHint: "[list] | add [--project] <text> | ack <id> | drop <id>",
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")
      if (!hasGitRepo(identity)) return respond(ctx, "memory repository is not initialized yet; run /memfs init first", "error")
      const [verb = "list", ...rest] = args.trim().split(/\s+/).filter(Boolean)
      const repo = openRepo(deps, identity)
      if (verb === "list") return respond(ctx, renderList(agreementItemsOf(await readAgreementsWorktree(repo.dir))))
      if (verb === "add") return add(deps, ctx, identity, repo, rest)
      if ((verb === "ack" || verb === "drop") && rest.length === 1 && rest[0] !== undefined) {
        const id = rest[0]
        const change = verb === "ack" ? ackAgreement : dropAgreement
        return write(deps, ctx, identity, repo, `${verb} agreement ${id}`, (items) => change(items, id), `no agreement has id ${id}`)
      }
      return respond(ctx, USAGE, "error")
    },
  })
}

function add(
  deps: MemoryCommandDeps,
  ctx: MemoryCommandContext,
  identity: MemoryCommandIdentity,
  repo: GitMemoryRepo,
  words: readonly string[],
): Promise<string> | string {
  const project = words[0] === "--project"
  const text = cleanAgreementText((project ? words.slice(1) : words).join(" "))
  const problem = agreementTextProblem(text)
  if (problem !== undefined) return respond(ctx, `${problem}\n${USAGE}`, "error")
  const today = new Date(deps.now?.() ?? Date.now()).toISOString().slice(0, 10)
  return write(deps, ctx, identity, repo, "add agreement", (items) => addHumanAgreement(items, text, project ? "project" : "global", today))
}

async function write(
  deps: MemoryCommandDeps,
  ctx: MemoryCommandContext,
  identity: MemoryCommandIdentity,
  repo: GitMemoryRepo,
  reason: string,
  change: (items: readonly AgreementItem[]) => readonly AgreementItem[] | undefined,
  missing = "nothing to change",
): Promise<string> {
  let unknown = false
  const sessionId = sessionIdOf(ctx)
  try {
    const result = await commitMemoryWrite({
      repo,
      lock: writerLock(identity),
      reason,
      author: { agentId: identity.identity, authorName: "Human" },
      writer: "human-command",
      ...(sessionId === undefined ? {} : { provenance: { sessionId, userTurns: 0 } }),
      successLabel: `/agreements ${reason}`,
      apply: async () => {
        const existing = await readAgreementsWorktree(repo.dir)
        const next = change(agreementItemsOf(existing))
        if (next === undefined) {
          unknown = true
          return { affectedPaths: [] }
        }
        await mkdir(join(repo.dir, "system"), { recursive: true })
        const rendered = renderAgreementsFile(existing, next)
        await writeFile(join(repo.dir, AGREEMENTS_PATH), rendered, "utf8")
        return strippedLegacyUserHeader(existing, rendered)
          ? { affectedPaths: [AGREEMENTS_PATH], strippedPaths: [AGREEMENTS_PATH] }
          : { affectedPaths: [AGREEMENTS_PATH] }
      },
    })
    deps.bustPromptCache()
    return respond(ctx, `${result.message}\n${renderList(agreementItemsOf(await readAgreementsWorktree(repo.dir)))}`)
  } catch (error) {
    if (unknown) return respond(ctx, missing, "error")
    return respond(ctx, error instanceof Error ? error.message : String(error), "error")
  }
}

function writerLock(identity: MemoryCommandIdentity): MemoryWriteLock {
  return async (domain, operation) => {
    if (domain !== "memory-write") throw new Error(`unsupported lock domain '${domain}'`)
    const record = await createLockRecord(`/agreements (${identity.identity})`)
    return withLock(memoryWriterLockPath(identity.identityPaths.locks), record, operation, { waitTimeoutMs: 5_000 })
  }
}

function renderList(items: readonly AgreementItem[]): string {
  if (items.length === 0) return "no agreements yet; /agreements add <text> records one in your words"
  const ordered = sortAgreements(items)
  const flagged = ordered.filter((item) => item.status === "needs-human")
  return [...flagged, ...ordered.filter((item) => item.status !== "needs-human")].map((item) => [
    `${item.id}  [${item.scope}] [${item.by}] broken x${item.n}${item.status === "needs-human" ? "  NEEDS-HUMAN" : ""}`,
    `  ${item.text}`,
    `  since ${item.since ?? "?"}, last ${item.last ?? "never"}`,
  ].join("\n")).join("\n")
}
