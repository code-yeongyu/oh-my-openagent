import { describe, expect, it } from "bun:test"
import { gate } from "./work_item_header"
import { edit, HEADER_ID, intentOf, post, repairedText } from "./testing"

const good = "<@U000ALICE>: Fix the login page\n<https://chat.example.test/p1|from #general>\n\n\u23F3 working"
const item = { header_message_id: HEADER_ID, source: { url: "https://chat.example.test/p1", chat: "general" }, status_line: "\u23F3 working" }

describe("work_item_header gate", () => {
  it("#given a header in the full layout with an extra line #when run #then it passes", async () => {
    expect(await gate.run(intentOf("header", [post(`${good}\nTicket: <https://t.example.test/1|T-1>`)]), {}, { work_item: item })).toEqual({ ok: true })
  })

  it("#given a header with only the summary #when run #then source, blank and status lines are filled in", async () => {
    const result = await gate.run(intentOf("header", [post("<@U000ALICE>: Fix the login page")]), {}, { work_item: item })
    expect(repairedText(result)).toBe(good)
  })

  it("#given a status edit of the header that lost its status line and no work item status #when run #then it is refused", async () => {
    const intent = intentOf("status", [edit(HEADER_ID, "<@U000ALICE>: Fix the login page\n<https://chat.example.test/p1|from #general>")])
    expect(await gate.run(intent, {}, { work_item: { header_message_id: HEADER_ID } })).toEqual({
      refuse: "the header must end with a status line after a blank line",
    })
  })

  it("#given a header without source and no work item source #when run #then it is refused", async () => {
    expect(await gate.run(intentOf("header", [post("<@U000ALICE>: Fix it")]), {}, {})).toHaveProperty("refuse")
  })
})
