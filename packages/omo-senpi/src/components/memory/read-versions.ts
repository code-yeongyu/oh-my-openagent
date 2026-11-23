import { homedir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { memoryContentVersion } from "@oh-my-opencode/memory-core"
import { readFile, stat } from "@oh-my-opencode/memory-core/fs"
import type { MemoryIdentityContext } from "./context"
import { memoryReadLocation } from "./read-classifier-wiring"
import { isRecord } from "./wiring-context"

type ReadObservation = {
  readonly target: string
  readonly canonicalPath: string
  readonly ranged: boolean
  readonly stamp: string | undefined
}

export function createMemoryReadVersionCapture() {
  // A ranged or truncated result doesn't carry the whole file. Bracket the host read before
  // trusting a full-file digest from disk; a race must require a reread, not bless newer bytes.
  const starts = new WeakMap<MemoryIdentityContext, Map<string, ReadObservation>>()
  return {
    async start(context: MemoryIdentityContext, toolCallId: string, input: Record<string, unknown>, cwd?: string) {
      if (!context.observedVersions || typeof input.path !== "string") return
      const path = readPath(input.path, cwd)
      if (!path?.endsWith(".md")) return
      const repo = context.identityPaths.repo
      const location = memoryReadLocation(repo, path)
      if (location === undefined) return
      const target = resolve(repo, location.label)
      const stamp = await fileStamp(target)
      let calls = starts.get(context)
      if (calls === undefined) starts.set(context, (calls = new Map()))
      calls.set(toolCallId, {
        target,
        canonicalPath: location.canonicalPath,
        ranged: input.offset != null || input.limit != null,
        stamp,
      })
    },
    finish(context: MemoryIdentityContext, toolCallId: string, payload: Record<string, unknown>) {
      const calls = starts.get(context)
      const observation = calls?.get(toolCallId)
      calls?.delete(toolCallId)
      const versions = context.observedVersions
      if (observation === undefined || versions === undefined || payload.isError || !Array.isArray(payload.content))
        return
      return recordReadVersion(versions, observation, payload.content, payload.details)
    },
    forget(context: MemoryIdentityContext, toolCallId: string) {
      starts.get(context)?.delete(toolCallId)
    },
  }
}

async function recordReadVersion(
  versions: Map<string, string>,
  { target, canonicalPath, ranged, stamp }: ReadObservation,
  content: readonly unknown[],
  details: unknown,
): Promise<void> {
  const [part] = content
  let version = "changed during read"
  if (
    !ranged &&
    content.length === 1 &&
    isRecord(part) &&
    part.type === "text" &&
    typeof part.text === "string" &&
    !(isRecord(details) && details.truncation)
  ) {
    version = memoryContentVersion(part.text)
  } else if (stamp !== undefined && stamp === (await fileStamp(target))) {
    const bytes = await readFile(target).catch(() => undefined)
    if (bytes !== undefined && stamp === (await fileStamp(target))) version = memoryContentVersion(bytes)
  }
  versions.set(target, version)
  versions.set(canonicalPath, version)
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
