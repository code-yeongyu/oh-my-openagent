import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleOmoSdk } from "../../packages/omo-senpi/src/components/omo-sdk/assembly"
import { probeBase, repoGit } from "./base-probe"
import { prepareBaseTree } from "./base-tree"
import { REPO_ROOT } from "./registry"

// The rollback criterion of the security design's section 10 (#14950): the previous build (the merge base) reads the
// durable state this build writes through the root (the gateway store), exports no custody-bearing call without its
// checks, and the connector cell holds here. Synthetic state; runs whenever the merge base is readable.
// The build a rollback returns to: the last shipped release before the root (omo-ai v5.1.83), pinned by commit so neither
// a stack base that already carries the root nor a default branch that later gains it can stand in for it.
const SHIPPED_PRE_ROOT = "69a1863a457da06fb64ae788e335bf272f1df406"
const BASE = probeBase(repoGit, SHIPPED_PRE_ROOT)
const EXTENSION = "packages/omo-senpi/src/components/thread/gateway/testing/store-extension.mjs"
const registration = (tree: string) => ({
  name: "rollback",
  moduleUrl: `file://${join(tree, EXTENSION)}`,
  migrations: [["CREATE TABLE rollback_items (id INTEGER)"]],
  sessionCallable: [],
})

// The previous build's reading, in its own process so its modules never mix with this tree's.
const READER = `
const [tree, agentDir, home, registration] = [process.argv[1], process.argv[2], process.argv[3], JSON.parse(process.argv[4])]
const { createGatewayStore } = await import(tree + "/packages/omo-senpi/src/components/thread/gateway/store.ts")
const { createThreadSdk } = await import(tree + "/packages/omo-senpi/src/components/thread/sdk.ts")
const { createOmoSdk } = await import(tree + "/packages/omo-senpi/src/components/omo-sdk/index.ts")
const store = createGatewayStore({ agentDir })
const journal = await store.journalMode()
const stats = await store.stats()
await store.dispose()
const facade = createThreadSdk({ agentDir, cwd: home, uid: 501, user: "rollback" })
const reRegistered = await facade.registerStoreExtension(registration)
await facade.close?.()
const sdk = createOmoSdk({ env: { HOME: home }, cwd: home, home, ports: { desktopLaunch: () => false, credentialStore: { read: async () => null } } })
const exported = Object.keys(sdk).sort()
sdk.close?.()
console.log(JSON.stringify({ journal, transactions: typeof stats.transactions, reRegistered, exported }))
`

describe("rollback to the previous build (security design section 10)", () => {
  test.skipIf(!BASE.readable)(
    `#given state this build wrote through the root #then the previous build reads it, exports no root, and the connector cell refuses here${BASE.readable ? "" : ` [skipped: ${BASE.reason}]`}`,
    async () => {
      if (!BASE.readable) return
      const scratch = mkdtempSync(join(tmpdir(), "sdk-parity-rollback-"))
      const [agentDir, home, baseTree] = [join(scratch, "agent"), join(scratch, "home"), join(scratch, "base")]
      repoGit(["worktree", "add", "--detach", baseTree, BASE.base])
      try {
        prepareBaseTree(REPO_ROOT, baseTree)
        const options = { cwd: home, agentDir, home, env: { HOME: home }, ports: { desktopLaunch: () => false } }
        const root = assembleOmoSdk({ ...options, principal: { kind: "script", uid: 501 } }, {})
        expect(await root.threads.extensions.register(registration(REPO_ROOT))).toMatchObject({ kind: "ok" })
        await root.dispose()
        const connector = assembleOmoSdk({ ...options, principal: { kind: "connector", binding: "b-1" } }, {})
        expect(await connector.threads.extensions.register(registration(REPO_ROOT))).toMatchObject({
          error: { code: "sender_not_allowed" },
        })
        await connector.dispose()

        const read = JSON.parse(
          execFileSync(
            process.execPath,
            ["-e", READER, baseTree, agentDir, home, JSON.stringify(registration(baseTree))],
            { cwd: baseTree, encoding: "utf8" },
          ),
        ) as { journal: string; transactions: string; reRegistered: unknown; exported: string[] }
        expect(read.journal).toBe("wal")
        expect(read.transactions).toBe("number")
        expect(read.reRegistered).toEqual({ kind: "ok", value: { version: 1 } })
        expect(read.exported.includes("threads")).toBe(false)
      } finally {
        repoGit(["worktree", "remove", "--force", baseTree])
        repoGit(["worktree", "prune"])
        rmSync(scratch, { recursive: true, force: true })
      }
    },
  )
})
