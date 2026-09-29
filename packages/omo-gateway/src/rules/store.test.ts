import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { RuleFormatError } from "./format"
import { RulesStore, RulesStoreError, type NewRule } from "./store"

const tempDirs: string[] = []

async function openStore(): Promise<{ home: string; store: RulesStore }> {
  const home = realpathSync.native(await mkdtemp(join(tmpdir(), "gateway-rules-")))
  tempDirs.push(home)
  return { home, store: await RulesStore.openIdentity({ memoryHome: home, identity: "acme-gateway", cwd: home }) }
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeTree(dir, { maxRetries: 20, retryDelay: 250 }).catch(() => undefined)
  }
})

const ENGLISH_ONLY: NewRule = {
  scope: { gateway: "acme" },
  kind: "mechanical",
  gate: "language",
  params: { allow: ["en"] },
  set_by: "u_000ALICE",
  text: "English only in this workspace.",
}

const TAG_REQUESTER: NewRule = {
  scope: { gateway: "acme", chat: "C1" },
  kind: "behavioral",
  set_by: "u_000ALICE",
  source: "playbook:tag-requester",
  why: "Requesters miss untagged updates.",
  text: "Tag the requester on every status change.",
}

describe("RulesStore", () => {
  it("#given an empty scope memory repo #when rules are added, edited and revoked #then each change is one commit and history lists them in order", async () => {
    // given
    const { store } = await openStore()

    // when
    const first = await store.add(ENGLISH_ONLY)
    const second = await store.add(TAG_REQUESTER)
    await store.edit("acme", 2, { text: "Tag the requester on every status change and decision." })
    await store.revoke("acme", 2)
    const history = await store.history("acme", 2)
    const set = await store.load("acme")

    // then
    expect([first.rule.n, second.rule.n]).toEqual([1, 2])
    expect(first.path).toBe(`rules/acme/${first.rule.id}.md`)
    expect(history.map((commit) => commit.subject)).toEqual([
      "rules: add 2 Tag the requester on every status change.",
      "rules: edit 2 Tag the requester on every status change and decision.",
      "rules: revoke 2 Tag the requester on every status change and decision.",
    ])
    expect(set.rules.map(({ rule }) => [rule.n, rule.status, rule.source ?? null])).toEqual([
      [1, "active", null],
      [2, "revoked", "playbook:tag-requester"],
    ])
    expect(set.rules[1]?.rule.why).toBe("Requesters miss untagged updates.")
    expect(await store.repo.status()).toBe("")
  })

  it("#given rules added as one batch #when loaded and compiled #then the batch is one commit and a later rule still wins a tie", async () => {
    // given
    const { store } = await openStore()
    await store.add(TAG_REQUESTER)

    // when
    const batch = await store.addMany("acme", [ENGLISH_ONLY, { ...ENGLISH_ONLY, params: { allow: ["ko"] } }], "two language rules")
    const log = await store.repo.log({ paths: ["rules"] })
    const { compiled } = await store.compile({ gateway: "acme", chat: "C1" })

    // then
    expect(batch.map(({ rule }) => rule.n)).toEqual([2, 3])
    expect(log.map((commit) => commit.subject)).toEqual(["rules: import 2-3 two language rules", "rules: add 1 Tag the requester on every status change."])
    expect(compiled.version).toBe(log[0]?.sha ?? "missing")
    expect(compiled.gates.language).toEqual({ allow: ["ko"] })
    expect(await store.addMany("acme", [], "nothing")).toEqual([])
    expect(await store.repo.log({ paths: ["rules"] })).toHaveLength(2)
    expect(await store.repo.status()).toBe("")
  })

  it("#given a revoked rule #when it is edited or revoked again #then the store refuses without committing", async () => {
    // given
    const { store } = await openStore()
    await store.add(ENGLISH_ONLY)
    await store.revoke("acme", 1)
    const head = await store.repo.head()

    // when
    const edit = await store.edit("acme", 1, { text: "changed" }).catch((error: unknown) => error)
    const revoke = await store.revoke("acme", 1).catch((error: unknown) => error)
    const missing = await store.revoke("acme", 7).catch((error: unknown) => error)

    // then
    expect(edit).toBeInstanceOf(RulesStoreError)
    expect(revoke).toEqual(new RulesStoreError("rule 1 is revoked"))
    expect(missing).toEqual(new RulesStoreError("no rule 7 in scope acme"))
    expect(await store.repo.head()).toBe(head)
  })

  it("#given an input with an unknown gate or no gateway #when added #then it is rejected before anything is written", async () => {
    // given
    const { store } = await openStore()
    const head = await store.repo.head()

    // when
    const bogus = { ...ENGLISH_ONLY }
    Reflect.set(bogus, "gate", "emoji_budget")
    const unknownGate = await store.add(bogus).catch((error: unknown) => error)
    const badScope = await store.add({ ...ENGLISH_ONLY, scope: { gateway: "../outside" } }).catch((error: unknown) => error)

    // then
    expect(unknownGate).toEqual(new RuleFormatError("unknown gate 'emoji_budget'"))
    expect(badScope).toBeInstanceOf(RulesStoreError)
    expect(await store.repo.head()).toBe(head)
    expect(await store.repo.status()).toBe("")
  })

  it("#given rules and an unrelated memory commit #when the version is read #then it is the HEAD touching rules/ only", async () => {
    // given
    const { store } = await openStore()
    const before = await store.version()

    // when
    await store.add(ENGLISH_ONLY)
    const afterWrite = await store.version()
    const headAfterWrite = await store.repo.head()
    await mkdir(join(store.repo.dir, "system"), { recursive: true })
    await writeFile(join(store.repo.dir, "system", "persona.md"), "---\ndescription: persona\n---\nbody\n")
    await store.repo.commitWrite(["system/persona.md"], "remember persona", { agentId: "acme", authorName: "Memory" })
    const afterUnrelated = await store.version()

    // then
    expect(before).toBeNull()
    expect(afterWrite).toBe(headAfterWrite)
    expect(await store.repo.head()).not.toBe(headAfterWrite)
    expect(afterUnrelated).toBe(afterWrite)
    expect((await store.compile({ gateway: "acme", chat: "C1" })).compiled.version).toBe(afterWrite)
  })

  it("#given malformed rule files committed by hand #when the scope is loaded #then each is reported with a reason and valid rules still load", async () => {
    // given
    const { store } = await openStore()
    const valid = await store.add(ENGLISH_ONLY)
    const files: Record<string, string> = {
      "rules/acme/r_000000000000000001JBADGATE.md": "---\nid: r_000000000000000001JBADGATE\nn: 5\nscope: { gateway: acme }\nkind: mechanical\ngate: emoji_budget\nset_by: u_000ALICE\n---\nNo more than three emoji.\n",
      "rules/acme/r_000000000000000000001JNSCP.md": "---\nid: r_000000000000000000001JNSCP\nn: 6\nscope: { chat: C1 }\nkind: behavioral\nset_by: u_000ALICE\n---\nBe brief.\n",
      "rules/acme/notes.txt": "stray\n",
    }
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(store.repo.dir, "rules", "acme"), { recursive: true })
      await writeFile(join(store.repo.dir, path), content)
    }
    await store.repo.commitWrite(Object.keys(files), "hand edit", { agentId: "acme", authorName: "Human" })

    // when
    const set = await store.load("acme")
    const { rejected } = await store.compile({ gateway: "acme" })

    // then
    expect(set.rules.map(({ rule }) => rule.id)).toEqual([valid.rule.id])
    expect(Object.fromEntries(set.rejected.map((entry) => [entry.path, entry.reason]))).toEqual({
      "rules/acme/r_000000000000000001JBADGATE.md": "unknown gate 'emoji_budget'",
      "rules/acme/r_000000000000000000001JNSCP.md": "missing 'scope.gateway'",
      "rules/acme/notes.txt": "not a rule file (expected rules/<scope>/<id>.md)",
    })
    expect(rejected).toHaveLength(3)
  })

  it("#given two stores on one memory repo #when they write at the same time #then the writes serialize with distinct numbers", async () => {
    // given
    const { home, store: first } = await openStore()
    const second = await RulesStore.openIdentity({ memoryHome: home, identity: "acme-gateway", cwd: home })

    // when
    const written = await Promise.all([
      first.add({ ...TAG_REQUESTER, text: "writer one, rule a" }),
      second.add({ ...TAG_REQUESTER, text: "writer two, rule a" }),
      first.add({ ...TAG_REQUESTER, text: "writer one, rule b" }),
      second.add({ ...TAG_REQUESTER, text: "writer two, rule b" }),
    ])
    const set = await first.load("acme")
    const log = await first.repo.log({ paths: ["rules"] })

    // then
    expect(written.map(({ rule }) => rule.n).sort()).toEqual([1, 2, 3, 4])
    expect(set.rules.map(({ rule }) => rule.n)).toEqual([1, 2, 3, 4])
    expect(set.rejected).toEqual([])
    expect(log).toHaveLength(4)
    expect(await first.repo.status()).toBe("")
  })

  it("#given a scope memory identity #when rules are written #then only rules/ paths exist in the repo tree", async () => {
    // given
    const { home, store } = await openStore()

    // when
    await store.add(ENGLISH_ONLY)
    await store.add(TAG_REQUESTER)
    const tree = await store.repo.lsTree()

    // then
    expect(store.repo.dir.startsWith(join(home, "agents"))).toBe(true)
    expect(tree.length).toBe(2)
    expect(tree.every((path) => /^rules\/acme\/r_[0-9A-Z]{26}\.md$/.test(path))).toBe(true)
  })
})
