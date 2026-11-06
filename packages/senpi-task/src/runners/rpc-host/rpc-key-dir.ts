import { chmodSync, lstatSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { log } from "@oh-my-opencode/utils"

// The key-record check (`socket-auth.ts`) refuses an agent dir's `rpc/` when it is
// group- or world-writable (`mode & 0o022`), and the engine's host supervisor refuses
// it the same way at publish time — so a `rpc/` first created 0775 under umask 0002
// (#12194) leaves the task daemon unable to start. A recursive `mkdir { mode: 0o700 }`
// does NOT repair an already-existing 0775 directory (the mode only applies to
// directories the call itself creates), so the repair has to be explicit: create it
// 0700 when missing, and clear the refused write bits when it already exists.

const RPC_DIR_MODE = 0o700
const REFUSED_WRITE_BITS = 0o022

/**
 * Make `<agentDir>/rpc` pass the key-record check before the engine is asked to start
 * the task host: create it 0700 when missing, clear group/other write bits when it
 * already exists. A symlink, a non-directory, or a directory owned by someone else is
 * left alone — the engine's check refuses those with its own actionable error.
 * Never throws: a failure here is logged and the ensure proceeds, so the caller's
 * behaviour on an unhealable directory is exactly today's engine refusal.
 */
export function ensureRpcKeyDirectory(agentDir: string): void {
  const rpcDir = join(agentDir, "rpc")
  try {
    mkdirSync(rpcDir, { recursive: true, mode: RPC_DIR_MODE })
    const stat = lstatSync(rpcDir)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return
    if (stat.uid !== process.getuid?.()) return
    const mode = stat.mode & 0o7777
    if ((mode & REFUSED_WRITE_BITS) !== 0) chmodSync(rpcDir, mode & ~REFUSED_WRITE_BITS)
  } catch (error) {
    log("senpi-task rpc key directory heal failed; the engine check will report it", {
      dir: rpcDir,
      error: String(error),
    })
  }
}
