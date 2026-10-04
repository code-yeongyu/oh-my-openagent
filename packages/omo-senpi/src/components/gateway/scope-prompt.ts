import { GitMemoryRepo, parseMemoryFile, renderExternalProjection } from "@oh-my-opencode/memory-core"

import { escapeRuleText } from "./rules-block"
import { gatewaySessionId, type GatewayScopeAccess } from "./scope-access"

const BEGIN = "<!-- omo-gateway:scope-memory:begin -->"
const END = "<!-- omo-gateway:scope-memory:end -->"
const REGION = /<!-- omo-gateway:scope-memory:begin -->[\s\S]*?<!-- omo-gateway:scope-memory:end -->/g
const MAX_BYTES = 2_048

type DigestEntry = { readonly seq: number; readonly path: string; readonly title: string }

export function createScopeMemoryPromptHandler(access: GatewayScopeAccess) {
  return async (payload: unknown, eventCtx?: unknown) => {
    if (payload === null || typeof payload !== "object" || Reflect.get(payload, "type") !== "before_agent_start") return undefined
    const prompt: unknown = Reflect.get(payload, "systemPrompt")
    const sessionId = gatewaySessionId(eventCtx)
    if (typeof prompt !== "string" || sessionId === undefined) return undefined
    const member = await access.member(sessionId)
    const cwd = eventCtx !== null && typeof eventCtx === "object" && typeof Reflect.get(eventCtx, "cwd") === "string"
      ? String(Reflect.get(eventCtx, "cwd")) : process.cwd()
    const identity = member === null ? undefined : access.identity(member, cwd)
    if (identity === undefined || member === null) {
      if (!prompt.includes(BEGIN)) return undefined
      return { systemPrompt: prompt.replace(REGION, "").trimEnd() }
    }
    const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
    const head = await repo.head()
    const lines: string[] = []
    if (head !== null) {
      const paths = (await repo.lsTree(head)).filter((path) => path.startsWith("reference/") && path.endsWith(".md"))
      for (const path of paths) {
        const note = parseMemoryFile(await repo.show(head, path))
        const title = note.body.match(/^#\s+(.+)$/m)?.[1] ?? path
        lines.push(`${escapeRuleText(path)}: ${escapeRuleText(title)} - ${escapeRuleText(note.frontmatter.description)}`)
      }
      // Workers can discover the shared learning files without exposing personal-memory paths.
      if (member.role === "worker") {
        const paths = (await repo.lsTree(head)).filter((path) => path.startsWith("learnings/") && path.endsWith(".md"))
        for (const path of paths) {
          const note = parseMemoryFile(await repo.show(head, path))
          lines.push(`${escapeRuleText(path)}: ${escapeRuleText(note.frontmatter.description)}`)
        }
      }
    }
    const digest = member.role === "lead"
      ? await access.callAs<{ readonly entries: readonly DigestEntry[] }>(sessionId, "digestForSession", {})
      : { entries: [] }
    const header = `<scope-memory scope="${escapeRuleText(member.scope).replaceAll('"', "&quot;")}">\n`
      + `<projection>${escapeRuleText(identity.paths.repo)}</projection>\n`
    const footer = "\n</external_projection>\n</scope-memory>"
    const selected: string[] = []
    const prefix = renderExternalProjection([]).replace("</external_projection>", "").trimEnd()
    const fits = (line: string) => Buffer.byteLength(header + prefix + "\n" + [...selected, line].join("\n") + footer, "utf8") <= MAX_BYTES
    let lastSeq: number | undefined
    for (const entry of digest.entries) {
      const line = `${escapeRuleText(entry.path)}: ${escapeRuleText(entry.title)}`
      if (!fits(line)) break
      selected.push(line)
      lastSeq = entry.seq
    }
    for (const line of lines) {
      if (fits(line)) selected.push(line)
    }
    const block = header + prefix + "\n" + selected.join("\n") + footer
    const base = prompt.replace(REGION, "").trimEnd()
    if (lastSeq !== undefined && Reflect.get(payload, "preview") !== true) {
      await access.callAs(sessionId, "digestDelivered", { scope: member.scope, version: member.version, last_seq: lastSeq })
    }
    return { systemPrompt: `${base}\n\n${BEGIN}\n${block}\n${END}` }
  }
}
