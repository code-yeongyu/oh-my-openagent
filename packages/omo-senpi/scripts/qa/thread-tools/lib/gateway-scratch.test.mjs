import { expect, test } from "bun:test"
import { statSync } from "node:fs"

import { makeScratch } from "./gateway.mjs"

// senpi >= 2026.11.10-3 refuses a group-writable RPC key directory (unsafe_key_record); the shared QA hosts run
// under umask 002, so the scratch agent dir must be tightened regardless of the caller's umask.
test("#given a permissive umask #when a scratch sandbox is made #then its agent dir is owner-only", () => {
  const previous = process.umask(0o002)
  try {
    const scratch = makeScratch("umask-probe", { url: "http://127.0.0.1:1" })
    expect(statSync(scratch.agentDir).mode & 0o777).toBe(0o700)
  } finally {
    process.umask(previous)
  }
})
