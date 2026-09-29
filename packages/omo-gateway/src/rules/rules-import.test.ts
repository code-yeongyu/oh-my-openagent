import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { importRules, parseImportMap, planImport, RulesImportError } from "./rules-import"
import { RulesStore } from "./store"

const FIXTURES = join(import.meta.dir, "../../test/fixtures")
const dirs: string[] = []

async function fixture() {
  const prose = await readFile(join(FIXTURES, "slack-rules.md"), "utf8")
  const map = parseImportMap(JSON.parse(await readFile(join(FIXTURES, "slack-rules.map.json"), "utf8")))
  return { prose, map }
}

async function freshStore(): Promise<RulesStore> {
  const dir = await mkdtemp(join(tmpdir(), "gw-rules-import-"))
  dirs.push(dir)
  return RulesStore.openDir({ dir })
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("rules import", () => {
  it("#given the fixture prose and map #when imported #then 14 entries become 16 rule files with the mapped kinds and gates", async () => {
    const { prose, map } = await fixture()
    const store = await freshStore()
    const { imported } = await importRules(store, map.gateway, planImport(prose, "slack-rules.md", map))
    const files = await store.repo.lsTree("HEAD", `rules/${map.gateway}`)
    expect(map.entries.length).toBe(14)
    expect(files.length).toBe(16)
    const shape = imported.map(({ rule }) => [rule.kind, rule.gate, rule.scope.chat ?? rule.scope.user ?? "scope-wide"])
    expect(shape).toEqual([
      ["mechanical", "language", "scope-wide"],
      ["mechanical", "topic_scope", "scope-wide"],
      ["behavioral", null, "scope-wide"],
      ["mechanical", "one_request_one_thread", "C000WORK"],
      ["mechanical", "work_item_header", "C000WORK"],
      ["mechanical", "status_sync", "scope-wide"],
      ["mechanical", "numbered_options", "scope-wide"],
      ["mechanical", "decision_nag", "u_000OWNER"],
      ["behavioral", null, "u_000OWNER"],
      ["mechanical", "link_label", "scope-wide"],
      ["mechanical", "mention_requester", "scope-wide"],
      ["mechanical", "image_viewport", "scope-wide"],
      ["mechanical", "typing_while_writing", "scope-wide"],
      ["mechanical", "bot_ignore", "scope-wide"],
      ["behavioral", null, "C000SHARE"],
      ["behavioral", null, "scope-wide"],
    ])
    expect(imported[0]?.rule).toMatchObject({ params: { allow: ["en"] }, source: "slack-rules.md#L7", text: expect.stringContaining("English only") })
    expect(imported[13]?.rule.params).toEqual({ agent_accounts: ["slack:U000OTHERBOT"], honor_gateway_marker: true })
    expect((await store.repo.log({ paths: ["rules"] })).map((commit) => commit.subject)).toEqual(["rules: import 1-16 16 rule(s) from slack-rules.md"])
  })

  it("#given an imported scope #when the same import runs again #then nothing is added", async () => {
    const { prose, map } = await fixture()
    const store = await freshStore()
    const plan = planImport(prose, "slack-rules.md", map)
    await importRules(store, map.gateway, plan)
    const again = await importRules(store, map.gateway, plan)
    expect(again.imported).toEqual([])
    expect(again.skipped.length).toBe(16)
    expect(await store.repo.log({ paths: ["rules"] })).toHaveLength(1)
  })

  it("#given a map with an unknown gate or an anchor that matches nothing #when planned #then it is rejected before any write", async () => {
    const { prose, map } = await fixture()
    expect(() => parseImportMap({ ...map, entries: [{ anchor: "English only", kind: "mechanical", gate: "no_such_gate" }] })).toThrow("unknown gate 'no_such_gate'")
    const missing = parseImportMap({ ...map, entries: [{ anchor: "not in the file", kind: "behavioral" }] })
    expect(() => planImport(prose, "slack-rules.md", missing)).toThrow(RulesImportError)
    const ambiguous = parseImportMap({ ...map, entries: [{ anchor: "the", kind: "behavioral" }] })
    expect(() => planImport(prose, "slack-rules.md", ambiguous)).toThrow("matches")
  })
})
