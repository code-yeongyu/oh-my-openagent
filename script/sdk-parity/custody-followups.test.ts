import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { assembleOmoSdk } from "../../packages/omo-senpi/src/components/omo-sdk/assembly"

// The custody log's open follow-ups (security design 8.2), each waiting for a root call another slice builds. An entry
// is due the moment its call is served: this check then fails, and the owning slice adds the follow-up and removes the
// entry.

type Entry = {
  readonly finding: string
  readonly waits_for: string
  readonly owner: string
  readonly pull_request: number
}

const LIST = JSON.parse(readFileSync(join(import.meta.dir, "custody-followups.json"), "utf8")) as {
  readonly entries: readonly Entry[]
}

test.each(LIST.entries.map((entry) => [entry.waits_for, entry.owner, entry] as const))(
  "#given the follow-up waiting for %s (slice %s) #then that call is still not served on the root",
  async (_call, _owner, entry) => {
    const sdk = assembleOmoSdk({ principal: { kind: "person", uid: 501 }, env: {}, cwd: "/work", ports: {} }, {})
    const member = entry.waits_for.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), sdk)
    expect(await (member as (input: unknown) => Promise<unknown>)({})).toMatchObject({
      kind: "error",
      error: { code: "not_implemented" },
    })
  },
)
