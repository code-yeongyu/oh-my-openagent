import { homedir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { memoryContentVersion } from "@oh-my-opencode/memory-core"
import { readFile, stat } from "@oh-my-opencode/memory-core/fs"
import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { memoryReadLocation } from "./read-classifier-wiring"
import { isRecord, sessionIdFrom } from "./wiring-context"

export function registerMemoryReadVersions(
  pi: SenpiExtensionAPI,
  resolveContext: (sessionId?: string) => MemoryIdentityContext | undefined,
): void {
  // A ranged or truncated result doesn't carry the whole file. Bracket the host read before
  // trusting a full-file digest from disk; a race must require a reread, not bless newer bytes.
  const starts = new WeakMap<MemoryIdentityContext, Map<string, string>>()
  for (const event of ["tool_call", "tool_result"] as const) {
    pi.on(event, async (payload, ctx) => {
      if (!isRecord(payload) || payload.toolName !== "read" || typeof payload.toolCallId !== "string") return
      const id = sessionIdFrom(ctx)
      const context = id === undefined ? undefined : resolveContext(id)
      if (!context?.observedVersions || !isRecord(payload.input) || typeof payload.input.path !== "string") return
      const input = payload.input
      const path = readPath(payload.input.path, isRecord(ctx) && typeof ctx.cwd === "string" ? ctx.cwd : pi.cwd)
      if (!path?.endsWith(".md")) return
      const repo = context.identityPaths.repo
      const location = memoryReadLocation(repo, path)
      if (location === undefined) return
      const target = resolve(repo, location.label)
      let calls = starts.get(context)
      if (event === "tool_call") {
        if (!calls) starts.set(context, (calls = new Map()))
        const stamp = await fileStamp(target)
        if (stamp !== undefined) calls.set(payload.toolCallId, stamp)
        return
      }
      const before = calls?.get(payload.toolCallId)
      calls?.delete(payload.toolCallId)
      if (payload.isError || !Array.isArray(payload.content)) return
      const [part] = payload.content
      if (
        input.offset == null &&
        input.limit == null &&
        payload.content.length === 1 &&
        isRecord(part) &&
        part.type === "text" &&
        typeof part.text === "string" &&
        !(isRecord(payload.details) && payload.details.truncation)
      ) {
        const version = memoryContentVersion(part.text)
        context.observedVersions.set(target, version)
        context.observedVersions.set(location.canonicalPath, version)
        return
      }
      let version = "changed during read"
      if (before !== undefined && before === (await fileStamp(target))) {
        const bytes = await readFile(target).catch(() => undefined)
        if (bytes !== undefined && before === (await fileStamp(target))) version = memoryContentVersion(bytes)
      }
      context.observedVersions.set(target, version)
      context.observedVersions.set(location.canonicalPath, version)
    })
  }
}

async function fileStamp(path: string): Promise<string | undefined> {
  const info = await stat(path, { bigint: true }).catch(() => undefined)
  return info?.isFile() ? `${info.dev}:${info.ino}:${info.ctimeNs}:${info.size}` : undefined
}

function readPath(raw: string, cwd = process.cwd()): string | undefined {
  const path = raw.replace(/^@/, "")
  if (path.startsWith("file://")) {
    try {
      return fileURLToPath(path)
    } catch {
      return undefined
    }
  }
  return path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(cwd, path)
}
