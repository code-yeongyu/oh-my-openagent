import { describe, expect, it } from "bun:test"
import { gate } from "./reply_language_follows_user"
import { reply } from "./testing"

describe("reply_language_follows_user gate", () => {
  it("#given the user wrote Korean #when the reply is Korean with English identifiers #then it passes", async () => {
    const ctx = { last_inbound_text: "\uB85C\uADF8\uC778 \uD398\uC774\uC9C0 \uACE0\uCCD0\uC918" }
    expect(await gate.run(reply("\uACE0\uCCE4\uC2B5\uB2C8\uB2E4: loginPage handleSubmit"), {}, ctx)).toEqual({ ok: true })
  })

  it("#given the user wrote Korean #when the reply is English #then it is refused", async () => {
    const ctx = { last_inbound_text: "\uB85C\uADF8\uC778 \uD398\uC774\uC9C0 \uACE0\uCCD0\uC918" }
    expect(await gate.run(reply("Fixed the login page."), {}, ctx)).toEqual({ refuse: expect.stringContaining("Hangul") })
  })

  it("#given the user wrote English #when the reply is mostly Korean #then it is refused", async () => {
    const ctx = { last_inbound_text: "please fix the login page" }
    expect(await gate.run(reply("\uB85C\uADF8\uC778 \uD398\uC774\uC9C0\uB97C \uACE0\uCCE4\uC2B5\uB2C8\uB2E4"), {}, ctx)).toHaveProperty("refuse")
  })

  it("#given no inbound text #when run #then it passes", async () => {
    expect(await gate.run(reply("Fixed."), {}, {})).toEqual({ ok: true })
  })
})
