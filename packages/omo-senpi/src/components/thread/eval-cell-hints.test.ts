import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Every model-facing recovery hint in the thread family names the eval-cell form of a thread tool
 * (thread tools are eval-only since #12903): a hint that still says "call thread_list" sends the model
 * to a tool it cannot call directly and costs a turn.
 */
const HINT_FILES = [
  "reader.ts",
  "addressing.ts",
  "remote/outcome.ts",
  "remote/remote-ops.ts",
  "remote/cross-device.ts",
  "remote/relay-transport.ts",
  "control/local-control.ts",
  "control/relay-session-host.ts",
  "gateway/relay.ts",
  "gateway/engine.ts",
  "gateway/result.ts",
  "tools/internals.ts",
  "tools/relay-tools.ts",
]

const DIRECT_CALL = /\b(?:[Cc]all|[Uu]se|with|via|run) thread_[a-z_]+\b/g

describe("thread recovery hints name the eval cell", () => {
  test("#given every thread source file with a recovery hint #when its strings are scanned #then each thread tool mention is the tool.thread_* eval form", () => {
    const offenders: string[] = []
    let evalForms = 0
    for (const file of HINT_FILES) {
      const source = readFileSync(join(import.meta.dir, file), "utf8")
      for (const match of source.matchAll(DIRECT_CALL)) {
        const before = source.slice(Math.max(0, match.index - 5), match.index)
        if (before.endsWith("tool.")) continue
        offenders.push(`${file}: ${match[0]}`)
      }
      evalForms += (source.match(/tool\.thread_[a-z_]+/g) ?? []).length
    }

    expect(offenders).toEqual([])
    expect(evalForms).toBeGreaterThanOrEqual(HINT_FILES.length)
  })
})
