import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { mapPlaybook, parsePlaybookMap, PLAYBOOK_IMPORTER, PlaybookMapError } from "./map"
import { parsePlaybook, readPlaybook } from "./parse"

const FIXTURES = join(import.meta.dir, "../../../test/fixtures")
const ENGLISH = "rules/slack.md#write-in-english-only-in-the-shared-workspace"
const BARE_URL = "rules/slack.md#never-post-a-bare-url-label-every-link-repo-number-title"

async function fixture() {
  const parsed = parsePlaybook(await readPlaybook(join(FIXTURES, "playbook")))
  const map = parsePlaybookMap(JSON.parse(await readFile(join(FIXTURES, "playbook-map.json"), "utf8")))
  return { parsed, map }
}

describe("playbook mapper", () => {
  it("#given the fixture playbook and map #when mapped #then each entry is one record with surface, why and enforced kept", async () => {
    const { parsed, map } = await fixture()
    const mapped = mapPlaybook(parsed, { gateway: "qa", map })

    expect(mapped.records.length).toBe(parsed.entries.length)
    expect(mapped.problems).toEqual([])
    expect(mapped.unused_map_keys).toEqual([])
    expect(mapped.records.map((rule) => [rule.source, rule.kind, rule.gate ?? null, rule.scope.surface ?? null])).toEqual([
      ["playbook:lessons/2026-01-03-stale-number.md", "behavioral", null, null],
      ["playbook:lessons/2026-01-04-duplicate-reminder.md", "behavioral", null, null],
      [`playbook:${ENGLISH}`, "mechanical", "language", "slack"],
      [`playbook:${BARE_URL}`, "mechanical", "link_label", "slack"],
      ["playbook:rules/slack.md#greet-a-new-member-once-in-the-channel-they-joined", "behavioral", null, "slack"],
      ["playbook:rules/telegram.md#keep-each-reply-in-one-message-unless-it-is-longer-than-the-platform-limit", "behavioral", null, "telegram"],
      ["playbook:rules/working-style.md#answer-the-question-first-then-give-the-detail", "behavioral", null, null],
      ["playbook:rules/working-style.md#report-a-result-only-with-evidence-from-the-real-surface", "behavioral", null, null],
    ])
    expect(mapped.records.every((rule) => rule.set_by === PLAYBOOK_IMPORTER && rule.scope.gateway === "qa")).toBe(true)
    expect(mapped.records[2]).toMatchObject({
      params: { allow: ["en"] },
      text: "Write in English only in the shared workspace.",
      why: "The example team works in one shared language.",
      enforced: "The sender refuses text outside the allowed languages.",
    })
    expect(mapped.records[3]?.why).toBe("Bare links are hard to read on a small screen. Lesson: An unlabeled link in a status update was skipped by every reader.")
    expect(mapped.records[0]).toMatchObject({
      text: "lesson: A report cited a stale number - Measure every number at the time of the report.",
      why: "A status report copied a count from an older message instead of measuring it again. Impact: The reader acted on a number that was no longer true.",
    })
  })

  it("#given a map with surface overrides, also_behavioral and a stale key #when mapped #then the override lands, the extra record appears and the stale key is reported", async () => {
    const { parsed } = await fixture()
    const map = parsePlaybookMap({
      surfaces: { slack: "slack:T000TEST" },
      entries: {
        [ENGLISH]: { gate: "language", params: { allow: ["en"] }, also_behavioral: true, locked: true },
        "rules/slack.md#a-rule-that-was-removed": { gate: "bot_ignore" },
      },
    })
    const mapped = mapPlaybook(parsed, { gateway: "qa", map })

    const english = mapped.records.filter((rule) => rule.source === `playbook:${ENGLISH}`)
    expect(english.map((rule) => [rule.kind, rule.gate ?? null, rule.locked, rule.scope.surface])).toEqual([
      ["mechanical", "language", true, "slack:T000TEST"],
      ["behavioral", null, true, "slack:T000TEST"],
    ])
    expect(mapped.records.find((rule) => rule.source === `playbook:${BARE_URL}`)?.kind).toBe("behavioral")
    expect(mapped.unused_map_keys).toEqual(["rules/slack.md#a-rule-that-was-removed"])
  })

  it("#given a malformed map #when parsed #then gates outside the closed set, bad params, unknown keys and surfaces are rejected", () => {
    expect(() => parsePlaybookMap({ entries: { [ENGLISH]: { gate: "no_such_gate" } } })).toThrow("unknown gate 'no_such_gate'")
    expect(() => parsePlaybookMap({ entries: { [ENGLISH]: { gate: "language" } } })).toThrow("params.allow")
    expect(() => parsePlaybookMap({ entries: { [ENGLISH]: { gate: "bot_ignore", scope: {} } } })).toThrow("unknown key 'scope'")
    expect(() => parsePlaybookMap({ entries: { "lessons/2026-01-03-stale-number.md": { gate: "bot_ignore" } } })).toThrow(PlaybookMapError)
    expect(() => parsePlaybookMap({ surfaces: { irc: "irc:x" } })).toThrow("unknown surface 'irc'")
    expect(() => parsePlaybookMap({ gateway: "qa" })).toThrow("unknown key 'gateway'")
  })
})
