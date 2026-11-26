import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { accountHome } from "../../account-core/src/account-home"
import { AUDIT_UNAVAILABLE_NOTE, custodyLogPath } from "../../account-core/src/calls/custody-log"
import type { CredentialStore } from "../../account-core/src/keystore"
import { runAccountVerb } from "../account-cli"

// Security design 8.2 (review 6065710236 N7): when the custody log cannot be written, `omo account forget` still forgets
// this device, exactly as today, and tells the person on stderr that the change is not in the log.

const logDir = dirname(custodyLogPath(accountHome()))
const created: string[] = []
afterEach(() => {
  rmSync(logDir, { recursive: true, force: true })
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

test("#given a custody log that cannot be written #when omo account forget runs #then it forgets and prints the note", async () => {
  mkdirSync(dirname(logDir), { recursive: true })
  rmSync(logDir, { recursive: true, force: true })
  writeFileSync(logDir, "a file where the custody log's directory should be")
  let cleared = false
  const store: CredentialStore = {
    read: async () => null,
    readAuthoritative: async () => null,
    write: async () => undefined,
    clear: async () => {
      cleared = true
    },
  }
  const home = mkdtempSync(join(tmpdir(), "omo-audit-note-"))
  created.push(home)
  const out: string[] = []
  const err: string[] = []
  const code = await runAccountVerb(
    {
      api: "http://127.0.0.1:1",
      store,
      home,
      pinDir: () => join(home, "sync-device"),
      readStdin: async () => "",
      output: (line) => out.push(line),
      error: (line) => err.push(line),
    },
    ["forget"],
  )
  expect({ code, out, cleared, note: err.includes(AUDIT_UNAVAILABLE_NOTE) }).toEqual({
    code: 0,
    out: [JSON.stringify({ forgotten: true })],
    cleared: true,
    note: true,
  })
})
