import { describe, expect, it } from "bun:test"
import { RuleFormatError, parseRuleFile, serializeRuleFile, type RuleRecord } from "./format"

const RULE: RuleRecord = {
  id: "r_000000000000000000001JTEST",
  n: 12,
  scope: { gateway: "sisyphuslabs", surface: "slack:T000TEST", chat: "C0000WORK", thread: null, user: null, agent: null },
  kind: "mechanical",
  gate: "language",
  params: { allow: ["en"] },
  applies_to: ["lead", "worker"],
  set_by: "u_01J0000000000000000ALICE",
  source: "https://example.slack.com/archives/C0000WORK/p0000",
  why: "The channel is read by: an English-only audience # always",
  enforced: "Sends outside English are refused.",
  status: "active",
  supersedes: null,
  locked: false,
  text: "English only in this workspace.",
}

function fileWith(header: string, body = "English only.\n"): string {
  return `---\n${header}\n---\n${body}`
}

const VALID_HEADER = [
  "id: r_000000000000000000001JTEST",
  "n: 1",
  "scope: { gateway: sisyphuslabs, chat: C0000WORK }",
  "kind: mechanical",
  "gate: language",
  "params: { allow: [en] }",
  "set_by: u_01J0000000000000000ALICE",
].join("\n")

function reasonFor(content: string): string {
  try {
    parseRuleFile(content)
  } catch (error) {
    if (error instanceof RuleFormatError) return error.message
    throw error
  }
  throw new Error("expected the rule file to be rejected")
}

describe("rule file format", () => {
  it("#given a rule with every optional field #when serialized and parsed #then the record round-trips exactly", () => {
    // given
    const content = serializeRuleFile(RULE)

    // when
    const parsed = parseRuleFile(content)

    // then
    expect(parsed).toEqual(RULE)
    expect(serializeRuleFile(parsed)).toBe(content)
  })

  it("#given a rule without source, why and enforced #when round-tripped #then the optional keys stay absent", () => {
    // given
    const { source: _source, why: _why, enforced: _enforced, ...bare } = RULE

    // when
    const content = serializeRuleFile(bare)
    const parsed = parseRuleFile(content)

    // then
    expect(content).not.toContain("source:")
    expect(content).not.toContain("why:")
    expect(parsed).toEqual(bare)
  })

  it("#given a hand-written file in the Design record shape #when parsed #then defaults fill the omitted keys", () => {
    // given
    const content = fileWith(VALID_HEADER)

    // when
    const parsed = parseRuleFile(content)

    // then
    expect(parsed.scope).toEqual({ gateway: "sisyphuslabs", surface: null, chat: "C0000WORK", thread: null, user: null, agent: null })
    expect(parsed.applies_to).toEqual(["lead", "worker"])
    expect(parsed.status).toBe("active")
    expect(parsed.locked).toBe(false)
    expect(parsed.text).toBe("English only.")
  })

  it("#given a file naming a gate outside the closed set #when parsed #then it is rejected with the gate id as reason", () => {
    // given
    const content = fileWith(VALID_HEADER.replace("gate: language", "gate: emoji_budget"))

    // when
    const reason = reasonFor(content)

    // then
    expect(reason).toBe("unknown gate 'emoji_budget'")
  })

  it("#given a file whose scope has no gateway #when parsed #then it is rejected as missing scope.gateway", () => {
    // given
    const content = fileWith(VALID_HEADER.replace("scope: { gateway: sisyphuslabs, chat: C0000WORK }", "scope: { chat: C0000WORK }"))

    // when
    const reason = reasonFor(content)

    // then
    expect(reason).toBe("missing 'scope.gateway'")
  })

  it("#given malformed files #when parsed #then each is rejected with a specific reason", () => {
    // given
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["no frontmatter at all\n", "missing frontmatter"],
      [fileWith(`${VALID_HEADER}\nparams: [unclosed`), "duplicate frontmatter key 'params'"],
      [fileWith(VALID_HEADER.replace("params: { allow: [en] }", "params: { allow: [en")), "frontmatter is not valid YAML"],
      [fileWith(`${VALID_HEADER}\ncolor: blue`), "unknown frontmatter key 'color'"],
      [fileWith(VALID_HEADER.replace("chat: C0000WORK", "chat: 123456789012345678")), "'scope.chat' must be a non-empty string or null"],
      [fileWith(VALID_HEADER.replace("scope: { gateway: sisyphuslabs,", "scope: { gateway: ../escape,")), "'scope.gateway' is not a safe scope id"],
      [fileWith(VALID_HEADER.replace("kind: mechanical", "kind: behavioral")), "a behavioral rule must not name a gate"],
      [fileWith(VALID_HEADER.replace("params: { allow: [en] }", "params: { allow: [] }")), "params.allow for gate 'language'"],
      [fileWith(VALID_HEADER.replace("gate: language\nparams: { allow: [en] }", "gate: session_unit\nparams: { slack: topic }")), "session_unit 'slack' must be one of thread, chat"],
      [fileWith(VALID_HEADER, "   \n"), "rule text (the body after the frontmatter) must not be empty"],
      [fileWith(VALID_HEADER.replace("n: 1", "n: 0")), "'n' must be a positive integer"],
    ]

    // when
    const reasons = cases.map(([content]) => reasonFor(content))

    // then
    reasons.forEach((reason, index) => expect(reason).toContain(cases[index]?.[1] ?? "<missing case>"))
  })

  it("#given strings that YAML would coerce #when serialized #then they are quoted and read back as strings", () => {
    // given
    const tricky: RuleRecord = {
      ...RULE,
      scope: { ...RULE.scope, chat: "1234567890", thread: "1727000000.000100", user: "null", agent: "yes" },
      set_by: "true",
      text: "Line one\n---\nline three after a dash rule",
    }

    // when
    const parsed = parseRuleFile(serializeRuleFile(tricky))

    // then
    expect(parsed).toEqual(tricky)
  })
})
