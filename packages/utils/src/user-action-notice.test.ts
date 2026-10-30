import { expect, test } from "bun:test"
import { userActionNotice } from "./user-action-notice"

test("a notice is withheld when the user has no action to take", () => {
  expect(userActionNotice("A task was interrupted.", undefined)).toBeUndefined()
})

test("an actionable notice includes both its reason and its action", () => {
  expect(userActionNotice("A task could not finish.", "Retry it.")).toBe("A task could not finish. Retry it.")
})
