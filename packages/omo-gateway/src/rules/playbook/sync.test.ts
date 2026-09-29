import { afterEach, describe, expect, it } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serializeRuleFile } from "../format"
import { RulesStore } from "../store"
import { parsePlaybookMap } from "./map"
import { applyPlaybookSync, dryRunPlaybookSync, PlaybookSyncError } from "./sync"

const FIXTURES = join(import.meta.dir, "../../../test/fixtures")
const ENGLISH = "playbook:rules/slack.md#write-in-english-only-in-the-shared-workspace"
const GREET = "playbook:rules/slack.md#greet-a-new-member-once-in-the-channel-they-joined"
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "gw-playbook-sync-"))
  dirs.push(root)
  const playbook = join(root, "playbook")
  await cp(join(FIXTURES, "playbook"), playbook, { recursive: true })
  await mkdir(join(root, "memory"))
  const store = await RulesStore.openDir({ dir: join(root, "memory") })
  const map = parsePlaybookMap(JSON.parse(await readFile(join(FIXTURES, "playbook-map.json"), "utf8")))
  const plan = () => dryRunPlaybookSync({ root: playbook, gateway: "qa", map, store })
  const sync = async () => {
    const planned = await plan()
    return { plan: planned, result: await applyPlaybookSync(store, planned) }
  }
  const commits = async () => (await store.repo.log({ paths: ["rules"] })).length
  const rewrite = async (file: string, change: (content: string) => string) => {
    const path = join(playbook, file)
    await writeFile(path, change(await readFile(path, "utf8")), "utf8")
  }
  const record = async (source: string) => {
    const found = (await store.load("qa")).rules.find((stored) => stored.rule.source === source && stored.rule.status === "active")
    if (found === undefined) throw new Error(`no active record for ${source}`)
    return found
  }
  return { playbook, store, plan, sync, commits, rewrite, record }
}

function changes(plan: Awaited<ReturnType<typeof dryRunPlaybookSync>>) {
  return { add: plan.add.length, edit: plan.edit.length, revoke: plan.revoke.length, unchanged: plan.unchanged.length }
}

describe("playbook sync", () => {
  it("#given an empty scope #when the fixture playbook syncs #then one record per entry lands, one commit each", async () => {
    const { sync, commits, store } = await setup()
    const { plan, result } = await sync()

    expect(plan.counts).toEqual({ entries: 8, records: 8 })
    expect(changes(plan)).toEqual({ add: 8, edit: 0, revoke: 0, unchanged: 0 })
    expect(result.commits).toBe(8)
    expect(await commits()).toBe(8)
    const rules = (await store.load("qa")).rules.map(({ rule }) => rule)
    expect(rules.filter((rule) => rule.kind === "mechanical").map((rule) => rule.gate)).toEqual(["language", "link_label"])
  })

  it("#given a synced scope #when the unchanged playbook, then a reformatted copy of it, syncs again #then both re-syncs are no-ops with zero commits", async () => {
    const { sync, commits, rewrite } = await setup()
    await sync()

    const again = await sync()
    expect(changes(again.plan)).toEqual({ add: 0, edit: 0, revoke: 0, unchanged: 8 })
    expect(again.result.commits).toBe(0)

    await rewrite("rules/slack.md", (content) => content.replace("\n\n###", "\n\nAn extra intro paragraph.\n\n\n###").replace(/\n/g, "\r\n"))
    await rewrite("rules/working-style.md", (content) => `\n\n${content}`)
    const reformatted = await sync()
    expect(changes(reformatted.plan)).toEqual({ add: 0, edit: 0, revoke: 0, unchanged: 8 })
    expect(reformatted.result.commits).toBe(0)
    expect(await commits()).toBe(8)
  })

  it("#given a synced scope #when a ### entry is added at the top of a file #then exactly one record and one commit are added, with no code change", async () => {
    const { sync, commits, rewrite, record } = await setup()
    await sync()
    await rewrite("rules/slack.md", (content) => content.replace("\n\n###", "\n\n### Thank the reporter of every bug.\n- Why: Reporters keep reporting when thanked.\n- Enforced: Convention.\n- Added: 2026-01-05\n\n###"))

    const { plan, result } = await sync()
    expect(changes(plan)).toEqual({ add: 1, edit: 0, revoke: 0, unchanged: 8 })
    expect(plan.add[0]?.source).toBe("playbook:rules/slack.md#thank-the-reporter-of-every-bug")
    expect(result.commits).toBe(1)
    expect(await commits()).toBe(9)
    expect((await record("playbook:rules/slack.md#thank-the-reporter-of-every-bug")).rule.scope.surface).toBe("slack")
  })

  it("#given a synced scope #when a new surface file appears #then its entries import with that file's surface", async () => {
    const { sync, playbook, record } = await setup()
    await sync()
    await writeFile(join(playbook, "rules/github.md"), "# GitHub\n\n### Link the issue from every pull request.\n- Why: Reviewers need the context.\n- Enforced: Convention.\n- Added: 2026-01-06\n")

    const { plan } = await sync()
    expect(changes(plan)).toEqual({ add: 1, edit: 0, revoke: 0, unchanged: 8 })
    expect((await record("playbook:rules/github.md#link-the-issue-from-every-pull-request")).rule.scope.surface).toBe("github")
  })

  it("#given a synced scope #when one entry is deleted and another's Why changes #then exactly that record is revoked and the other edited", async () => {
    const { sync, rewrite, record, store } = await setup()
    await sync()
    const greet = await record(GREET)
    await rewrite("rules/slack.md", (content) => content.replace(/### Greet[\s\S]*?Added: 2026-01-02\n/, ""))
    await rewrite("rules/working-style.md", (content) => content.replace("hidden failures before.", "hidden failures more than once."))

    const { plan, result } = await sync()
    expect(changes(plan)).toEqual({ add: 0, edit: 1, revoke: 1, unchanged: 6 })
    expect(plan.revoke.map((entry) => [entry.n, entry.source])).toEqual([[greet.rule.n, GREET]])
    expect(plan.edit[0]?.patch).toEqual({ why: "An exit code alone has hidden failures more than once." })
    expect(result.commits).toBe(2)
    const after = (await store.load("qa")).rules.find((stored) => stored.rule.n === greet.rule.n)
    expect(after?.rule.status).toBe("revoked")
  })

  it("#given a record a person edited in the gateway #when its entry changes and is then deleted #then the record is untouched and reported", async () => {
    const { sync, rewrite, record, store, commits } = await setup()
    await sync()
    const english = await record(ENGLISH)
    const edited = serializeRuleFile({ ...english.rule, set_by: "u_000ALICE", text: "English only, including review comments." })
    await writeFile(join(store.repo.dir, english.path), edited, "utf8")
    await store.repo.commitWrite([english.path], `rules: edit ${english.rule.n} by hand`, { agentId: "gateway-rules", authorName: "Alice" })
    const before = await commits()

    await rewrite("rules/slack.md", (content) => content.replace("one shared language.", "one shared language, always."))
    const changed = await sync()
    expect(changed.plan.human_edited).toEqual([{ n: english.rule.n, source: ENGLISH, set_by: "u_000ALICE", withheld: "edit" }])
    expect(changes(changed.plan)).toEqual({ add: 0, edit: 0, revoke: 0, unchanged: 7 })

    await rewrite("rules/slack.md", (content) => content.replace(/### Write in English[\s\S]*?Added: 2026-01-01\n\n/, ""))
    const deleted = await sync()
    expect(deleted.plan.human_edited).toEqual([{ n: english.rule.n, source: ENGLISH, set_by: "u_000ALICE", withheld: "revoke" }])
    expect(deleted.plan.revoke).toEqual([])
    expect(await commits()).toBe(before)
    expect(await store.repo.show("HEAD", english.path)).toBe(edited)
  })

  it("#given a dry run #when it plans #then nothing is written, and a plan made against an older version is refused", async () => {
    const { plan, commits, store } = await setup()
    const planned = await plan()
    expect(planned.add.length).toBe(8)
    expect(await commits()).toBe(0)

    await store.add({ scope: { gateway: "qa" }, kind: "behavioral", set_by: "u_000ALICE", text: "A rule set by hand." })
    await expect(applyPlaybookSync(store, planned)).rejects.toThrow(PlaybookSyncError)
    expect(await commits()).toBe(1)
  })
})
