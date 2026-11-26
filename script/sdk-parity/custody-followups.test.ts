import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { assembleOmoSdk } from "../../packages/omo-senpi/src/components/omo-sdk/assembly"

// The custody log's open follow-ups (security design 8.2), each waiting for something another change brings: a root
// call another slice builds, or record fields design 8.2 has to name. An entry is due the moment what it waits for
// exists: its check then fails, and the owner lands the follow-up and removes the entry.

type CallEntry = { readonly finding: string; readonly waits_for: string; readonly owner: string }
type FieldEntry = {
  readonly finding: string
  readonly waits_for_design_fields: readonly string[]
  readonly owner: string
}
type Entry = CallEntry | FieldEntry

const LIST = JSON.parse(readFileSync(join(import.meta.dir, "custody-followups.json"), "utf8")) as {
  readonly entries: readonly Entry[]
}
const DESIGN = readFileSync(join(import.meta.dir, "../../docs/reference/omo-sdk-authority-and-custody.md"), "utf8")

const calls = LIST.entries.filter((entry): entry is CallEntry => "waits_for" in entry)
const fields = LIST.entries.filter((entry): entry is FieldEntry => "waits_for_design_fields" in entry)

test.each(calls.map((entry) => [entry.waits_for, entry.owner, entry] as const))(
  "#given the follow-up waiting for %s (%s) #then that call is still not served on the root",
  async (_call, _owner, entry) => {
    const sdk = assembleOmoSdk({ principal: { kind: "person", uid: 501 }, env: {}, cwd: "/work", ports: {} }, {})
    const member = entry.waits_for.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), sdk)
    expect(await (member as (input: unknown) => Promise<unknown>)({})).toMatchObject({
      kind: "error",
      error: { code: "not_implemented" },
    })
  },
)

test.each(fields.map((entry) => [entry.waits_for_design_fields.join(", "), entry.owner, entry] as const))(
  "#given the follow-up waiting for design fields %s (%s) #then 8.2's record table does not name them yet",
  (_fields, _owner, entry) => {
    const named = entry.waits_for_design_fields.filter((field) => DESIGN.includes(`| \`${field}\` |`))
    expect(named).toEqual([])
  },
)
