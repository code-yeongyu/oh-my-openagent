import { afterEach, beforeEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// For tests whose writes resolve the process-wide agent dir and cannot be handed a state dir: the
// engine caches compiled extension modules there even when a loader has its own agentDir, and the
// chaos harnesses build their record stores through default resolution. Left alone, those writes
// create the preload's shared agent dir (group-writable under umask 0002, then rejected as
// unsafe_key_record, #14573). Call this at a test file's top level to give each test its own.
export function useOwnedAgentDir(): void {
  const sharedAgentDir = process.env.PI_CODING_AGENT_DIR
  let ownedAgentDir: string | undefined
  beforeEach(() => {
    ownedAgentDir = mkdtempSync(join(tmpdir(), "senpi-task-agent-"))
    process.env.PI_CODING_AGENT_DIR = ownedAgentDir
  })
  afterEach(() => {
    process.env.PI_CODING_AGENT_DIR = sharedAgentDir
    if (ownedAgentDir !== undefined) rmSync(ownedAgentDir, { recursive: true, force: true })
    ownedAgentDir = undefined
  })
}
