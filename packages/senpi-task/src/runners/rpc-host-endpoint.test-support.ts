import { test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { EnsureTaskDaemonInput, EnsuredTaskDaemon } from "./rpc-host/daemon"
import type { FakeHost } from "./rpc-host/__fixtures__/fake-host"
import type { ShardResolution } from "./rpc-host/shard-socket"
import { ensuredDaemon } from "./rpc-host.test-support"

/** A shard-named endpoint (`p-<key>.sock`) that is a symlink to a fake host's socket. */
export interface ShardEndpoint {
  readonly socket: string
  readonly dir: string
  readonly key: string
  resolution(notice?: ShardResolution["notice"]): ShardResolution
}

/**
 * A case that opens a child through a shard endpoint. A shard endpoint here is a unix-socket alias of a fake
 * host; per-parent shard routing is POSIX-only by the rpc-host-sharding plan ("Per-parent shard routing as
 * the ONLY task-child routing on POSIX"; Must NOT: "No win32 behavior change ... `RpcHostRunner` still
 * unused there"), and win32 never selects the host runner (`engine-runners.ts`, `host-execution-mode.ts`),
 * where a named pipe is derived from the alias path and its own `.secret`, so no alias of a host exists.
 */
export const posixShardTest = test.skipIf(process.platform === "win32")

const created: string[] = []

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

export function shardEndpoint(host: FakeHost, key: string, dir = tempDir("dh-t7-shards-")): ShardEndpoint {
  const socket = join(dir, `p-${key}.sock`)
  symlinkSync(host.socketPath, socket)
  return {
    socket,
    dir,
    key,
    resolution: (notice) => ({
      socket,
      shard: { kind: "p", key, ownerSessionId: `root-${key}`, inherited: false },
      root: "primary",
      ...(notice === undefined ? {} : { notice }),
    }),
  }
}

export interface EnsureRecorder {
  readonly inputs: EnsureTaskDaemonInput[]
  readonly ensure: (input: EnsureTaskDaemonInput) => Promise<EnsuredTaskDaemon>
}

/** Records every ensure; `answer` decides it (default: the endpoint answers at the socket asked for). */
export function ensureRecorder(
  answer: (input: EnsureTaskDaemonInput, call: number) => Promise<EnsuredTaskDaemon> = (input) =>
    Promise.resolve(ensuredDaemon(input.socket ?? "<unnamed>")),
): EnsureRecorder {
  const inputs: EnsureTaskDaemonInput[] = []
  return {
    inputs,
    ensure: (input) => {
      inputs.push(input)
      return answer(input, inputs.length)
    },
  }
}

export function cleanupTempDirs(): void {
  for (const dir of created.splice(0)) {
    chmodSync(dir, 0o700)
    rmSync(dir, { recursive: true, force: true })
  }
}
