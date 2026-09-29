import { expect, test } from "bun:test"
import { documentedCapabilities } from "../../adapter/docs-matrix"
import { TELEGRAM_CAPABILITIES } from "./adapter"

test("the Telegram row of the platform matrix equals TELEGRAM_CAPABILITIES", () => {
  expect(documentedCapabilities("Telegram (bot)")).toEqual({ ...TELEGRAM_CAPABILITIES })
})
