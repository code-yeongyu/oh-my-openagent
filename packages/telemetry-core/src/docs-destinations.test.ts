import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

// #14920: the user-facing docs must disclose every telemetry destination the senders use.
// The hosts are the machine-consumed values pinned here; wording stays free.

const repoRoot = join(import.meta.dir, "..", "..", "..")
const DESTINATION_HOSTS = ["https://us.i.posthog.com", "https://t.omo.dev"] as const
const DOCS = ["docs/legal/privacy-policy.md", "docs/reference/senpi-telemetry.md"] as const

describe("telemetry destination disclosure in docs", () => {
  for (const doc of DOCS) {
    test(`#given ${doc} #when destination hosts are searched #then every destination is disclosed`, () => {
      const body = readFileSync(join(repoRoot, doc), "utf8")

      for (const host of DESTINATION_HOSTS) {
        expect(body).toContain(host)
      }
    })
  }
})
