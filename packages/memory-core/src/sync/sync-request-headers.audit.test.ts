import { expect, test } from "bun:test"
import { join } from "node:path"

// Protocol and security contract (#13691): the service's client floor reads the contract headers on every
// sync request, so a sync client that builds its own authorization header silently drops them, and after
// phrase genesis the account refuses it 426. Every sync-path request header is built by
// syncRequestHeaders(); this audit fails on any other bearer header in the sync clients.
const REPO = join(import.meta.dir, "../../../..")
const SCOPES = ["packages/memory-core/src/sync/**/*.ts", "packages/omo-senpi/src/components/memory/**/*.ts"]
const BUILDER = "packages/memory-core/src/sync/contract-version.ts"
const BEARER = /\bauthorization\s*:\s*`Bearer/

test("no sync-path client builds a bearer header except through syncRequestHeaders (#13691)", async () => {
  const offenders: string[] = []
  for (const scope of SCOPES)
    for await (const file of new Bun.Glob(scope).scan({ cwd: REPO })) {
      if (file === BUILDER || file.includes(".test.") || file.includes("test-support")) continue
      if (BEARER.test(await Bun.file(join(REPO, file)).text())) offenders.push(file)
    }

  expect(offenders.sort()).toEqual([])
})
