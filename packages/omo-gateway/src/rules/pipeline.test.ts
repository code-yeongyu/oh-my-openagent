import { describe, expect, it } from "bun:test"
import { createGithubTitleCache } from "./gates/github-titles"
import { GATES } from "./gates/registry"
import { eventOf, HEADER_ID, intentOf, post, reply, THREAD } from "./gates/testing"
import { OK, type GateOp, type OutboundGate } from "./gates/types"
import { runInboundGates, runOutboundGates, runRouterGates } from "./pipeline"

const github = createGithubTitleCache({ fetchTitle: async () => "\uD55C\uAE00 title" })

// Stands in for image_viewport with a repair that rewrites the text ops it is given.
function textRewritingGate(rewrite: (ops: readonly GateOp[]) => readonly GateOp[]): OutboundGate {
  return {
    id: "image_viewport",
    phase: "outbound",
    run(intent) {
      const ops = rewrite(intent.ops)
      return ops.length === intent.ops.length && ops.every((op, index) => op === intent.ops[index])
        ? OK
        : { repair: { ...intent, ops }, note: "rewrote the message" }
    },
  }
}

describe("runOutboundGates", () => {
  it("#given language allow en #when Korean text is sent #then the pipeline refuses with gate language", async () => {
    const result = await runOutboundGates(reply("\uC791\uC5C5 \uC644\uB8CC"), { language: { allow: ["en"] } })
    expect(result).toMatchObject({ verdict: "refused", gate: "language" })
  })

  it("#given no gates in force #when anything is sent #then it passes unchanged", async () => {
    const intent = reply("\uC791\uC5C5 https://x.test")
    expect(await runOutboundGates(intent, {})).toEqual({ verdict: "ok", value: intent, repairs: [] })
  })

  it("#given a repair adds text an earlier gate forbids #when run #then the next pass refuses it", async () => {
    const result = await runOutboundGates(reply("see https://github.com/acme/widget/pull/1"), { language: { allow: ["en"] }, link_label: {} }, { github })
    expect(result).toMatchObject({ verdict: "refused", gate: "language" })
    expect(result.repairs.map((entry) => entry.gate)).toEqual(["link_label"])
  })

  it("#given a question and several gates #when run #then repairs apply in order and the result settles", async () => {
    const intent = intentOf("question", [post("Ship now?")], { options: ["Yes", "No"] })
    const result = await runOutboundGates(intent, { mention_requester: {}, numbered_options: {}, decision_nag: {} }, {
      requester: "U000ALICE",
      decision: { ask: "U000OWNER" },
      work_item: { header_message_id: HEADER_ID },
    })
    expect(result.verdict).toBe("repaired")
    expect(result.repairs.map((entry) => entry.gate)).toEqual(["mention_requester", "numbered_options", "decision_nag"])
    if (result.verdict === "refused") throw new Error("unexpected refusal")
    const first = result.value.ops[0]
    expect(first?.op === "post" ? first.text : "").toBe("<@U000OWNER> <@U000ALICE> Ship now?\n1. Yes\n2. No")
  })

  it("#given a gate whose repair removes a text op #when run #then the pipeline refuses naming that gate", async () => {
    const dropPosts = textRewritingGate((ops) => ops.filter((op) => op.op !== "post"))
    const intent = intentOf("reply", [{ op: "typing", key: THREAD }, post("deploy finished")])
    const result = await runOutboundGates(intent, { image_viewport: {} }, {}, { ...GATES, image_viewport: dropPosts })
    expect(result).toMatchObject({ verdict: "refused", gate: "image_viewport", reason: "gate image_viewport tried to drop message text" })
  })

  it("#given a gate whose repair blanks every text #when run #then the pipeline refuses naming that gate", async () => {
    const blank = textRewritingGate((ops) => ops.map((op) => (op.op === "post" && op.text !== " " ? { ...op, text: " " } : op)))
    const result = await runOutboundGates(reply("deploy finished"), { image_viewport: {} }, {}, { ...GATES, image_viewport: blank })
    expect(result).toMatchObject({ verdict: "refused", gate: "image_viewport", reason: "gate image_viewport tried to drop message text" })
  })

  it("#given a gate whose params are broken #when run #then the pipeline refuses instead of throwing", async () => {
    expect(await runOutboundGates(reply("hi"), { language: { allow: ["xx"] } })).toMatchObject({ verdict: "refused", gate: "language", reason: expect.stringContaining("could not check") })
  })
})

describe("runInboundGates", () => {
  it("#given no rule #when a bot posts #then bot_ignore still drops it with a reason", async () => {
    const result = await runInboundGates(eventOf({ author: { platform_user_id: "B1", display: "ci", is_bot: true } }), {})
    expect(result).toMatchObject({ verdict: "refused", gate: "bot_ignore", reason: "ignored: ci is a bot" })
  })

  it("#given a human message #when run #then it passes", async () => {
    expect(await runInboundGates(eventOf(), { bot_ignore: { agent_accounts: ["slack:U000OTHERBOT"] } })).toMatchObject({ verdict: "ok" })
  })
})

describe("runRouterGates", () => {
  it("#given one_request_one_thread in force #when a top-level request arrives #then it opens a work item with the default unit", async () => {
    const result = await runRouterGates(eventOf(), { one_request_one_thread: {} })
    if (result.verdict === "refused") throw new Error(result.reason)
    expect(result.value).toMatchObject({ open_work_item: true, unit: "thread", session_key: { chat_id: "C000WORK", thread_id: null } })
  })

  it("#given a broken session_unit override #when routed #then it is refused, not dropped", async () => {
    expect(await runRouterGates(eventOf(), { session_unit: { slack: "page" } })).toMatchObject({ verdict: "refused", gate: "session_unit" })
  })
})
