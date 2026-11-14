import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BootstrapSetup } from "../remote-bootstrap"
import { REMOTE_EXIT, runRemoteVerb } from "../remote-cli"

// #13433: docs/reference/remote-sessions.md lists the same `omo remote` verbs, with the same flags, as the usage the
// command prints. The usage is read from the command itself (a bare `omo remote` prints it on a usage error).

const REFERENCE = join(import.meta.dir, "..", "..", "..", "docs", "reference", "remote-sessions.md")

async function printedUsage(): Promise<string> {
  const err: string[] = []
  const untouched = () => {
    throw new Error("the usage path contacted a dependency")
  }
  const code = await runRemoteVerb(
    {
      accountShow: untouched,
      stateDir: join(tmpdir(), "omo-remote-reference-absent"),
      connect: untouched,
      now: () => 0,
      output: () => {},
      write: () => {},
      error: (line) => err.push(line),
      bootstrap: {} as BootstrapSetup,
    },
    [],
  )
  expect(code).toBe(REMOTE_EXIT.usage)
  return err.join("\n")
}

/** verb -> its flags (without --json), from lines of the form "<verb> <args...>" (a "a | b" pair is two verbs). */
function verbFlags(lines: readonly string[]): Map<string, string[]> {
  const verbs = new Map<string, string[]>()
  for (const line of lines) {
    const [synopsis = ""] = line.split(/\s{2,}|#/)
    const flags = [...synopsis.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]).filter((flag) => flag !== "--json")
    const names = synopsis.includes(" | ")
      ? synopsis.split(" | ").map((part) => part.trim().split(" ")[0] ?? "")
      : [synopsis.split(" ")[0] ?? ""]
    for (const name of names) verbs.set(name, [...new Set(flags)].sort())
  }
  return verbs
}

function usageEntries(usage: string): string[] {
  return usage
    .split("\n")
    .filter((line) => /^  [a-z]/.test(line))
    .map((line) => line.trim())
}

function referenceEntries(markdown: string): string[] {
  const block = markdown.match(/```bash\n([\s\S]*?)```/)?.[1] ?? ""
  return block
    .split("\n")
    .filter((line) => line.startsWith("omo remote "))
    .map((line) => line.slice("omo remote ".length))
}

describe("the omo remote reference", () => {
  test("lists every verb of the printed usage, and no other, each with the same flags", async () => {
    const usage = verbFlags(usageEntries(await printedUsage()))
    const reference = verbFlags(referenceEntries(readFileSync(REFERENCE, "utf8")))
    expect(usage.size).toBeGreaterThan(0)
    expect([...reference.keys()].sort()).toEqual([...usage.keys()].sort())
    for (const [verb, flags] of usage) expect([verb, reference.get(verb)]).toEqual([verb, flags])
  })
})
