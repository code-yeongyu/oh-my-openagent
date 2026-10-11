import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"

import { altRoot, shardKey, type ShardIdentity } from "./shard-socket"

export const OWNER = "01a0e28d-40e4-7402-bac7-8de6e76ad84c"
export const OWNER_KEY = "6d410ba846ba1550"
export const LONG_ROOT = `/${"r".repeat(119)}`
export const LEGACY_OVERRIDES = { OMO_RPC_SOCKET: "/legacy/brand.sock", OMO_RPC_SOCKET_PATH: "/legacy/desktop.sock" }

const createdAgentDirs: string[] = []

export function freshAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "shard-socket-test-"))
  createdAgentDirs.push(dir)
  return dir
}

export function removeFreshAgentDirs(): void {
  for (const dir of createdAgentDirs.splice(0)) {
    rmSync(altRoot(dir), { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
}

export function rootIdentity(): ShardIdentity {
  return { kind: "p", key: shardKey("p", OWNER), ownerSessionId: OWNER, inherited: false }
}

export function inheritedIdentity(): ShardIdentity {
  return { kind: "p", key: OWNER_KEY, ownerSessionId: "child-session-0002", inherited: true }
}

/** A POSIX-spelled path literal in this platform's separators, exactly as `path.join` spells it. */
export function nativePath(posixPath: string): string {
  return posixPath.split("/").join(sep)
}
