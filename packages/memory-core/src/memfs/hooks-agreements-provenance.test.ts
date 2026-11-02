import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { addHumanAgreement } from "../agreements/mutate"
import { agreementItemsOf, renderAgreementsFile } from "../agreements/ledger-file"
import { AGREEMENTS_PATH } from "../agreements/types"
import type { ClaimReceipt } from "../provenance"
import { MIXED_PROVENANCE, readHeader, stampReceipt } from "../tools/claim-frontmatter"
import { parseMemoryFile, renderMemoryFile } from "./frontmatter"
import { commit, createRepo, removeTempDirs } from "./hooks.test-support"

afterEach(removeTempDirs)
setDefaultTimeout(process.platform === "win32" ? 60000 : 20000)

// The agreement ledger (#10780) is written by two lanes that are not the memory tool. They must follow the same header
// rule the hook enforces on every such writer: a user-record header is lowered to "mixed", a legacy one is dropped.
const checker = { execPath: process.execPath, script: join(import.meta.dir, "memory-hook-cli.ts") }
const USER: ClaimReceipt = { source: "user", userQuote: "keep the ledger", approves: "0123456789abcdef" }
const LEDGER_BODY = "- [agent] a1 (n=1) Run the tests before pushing.\n"
const LEGACY = '"user said \\"yes\\" approving proposal 0123456789abcdef (body sha256:0123456789abcdef)"'
const WRITERS = {
  "/agreements": "agreements: add\n\nOmo-Writer: human-command\nOmo-Session: s\nOmo-Turn: 0",
  "facts lane": "chore(facts): extract 1 fact\n\nGenerated-By: facts-extractor\nOmo-Writer: facts-extractor\nOmo-Facts-Batch: b1",
} as const
const SEEDS = {
  "a user-record header": renderMemoryFile(stampReceipt(undefined, { description: "Working agreements" }, LEDGER_BODY, USER), LEDGER_BODY),
  "a legacy user header": `---\ndescription: Working agreements\nprovenance: ${LEGACY}\n---\n\n${LEDGER_BODY}`,
} as const
const EXPECTED_HEADER = { "a user-record header": MIXED_PROVENANCE, "a legacy user header": undefined } as const

describe("memory hooks with the engine checker: the agreement ledger writers follow the header rule (#10498 x #10780)", () => {
  for (const [seedName, seed] of Object.entries(SEEDS) as [keyof typeof SEEDS, string][]) {
    for (const [writer, message] of Object.entries(WRITERS)) {
      it(`#given a ledger with ${seedName} #when the ${writer} writes it through renderAgreementsFile #then the commit lands and the header follows the rule`, async () => {
        const dir = await createRepo({ checker })
        expect((await commit(dir, { [AGREEMENTS_PATH]: seed }, "ledger\n\nOmo-Writer: memory-tool")).code).toBe(0)
        const existing = await readFile(join(dir, AGREEMENTS_PATH), "utf8")
        const next = addHumanAgreement(agreementItemsOf(existing), "Ask before deleting a branch.", "global", "2026-10-22")
        const result = await commit(dir, { [AGREEMENTS_PATH]: renderAgreementsFile(existing, next) }, message)
        expect({ seedName, writer, code: result.code, said: result.code === 0 ? "" : (result.stdout + result.stderr).trim().slice(0, 160) }).toEqual({ seedName, writer, code: 0, said: "" })
        const header = readHeader(parseMemoryFile(await readFile(join(dir, AGREEMENTS_PATH), "utf8")).frontmatter)
        expect({ seedName, header }).toEqual({ seedName, header: EXPECTED_HEADER[seedName] })
      })
    }
  }
})
