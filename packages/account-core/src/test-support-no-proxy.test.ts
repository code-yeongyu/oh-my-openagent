import { afterAll, expect, test } from "bun:test"
import { fakeApi } from "./test-support"

const before = process.env.NO_PROXY

test("two fake APIs in one test share one NO_PROXY override", () => {
  fakeApi(() => Response.json({ ok: true }))
  fakeApi(() => Response.json({ ok: true }))
  expect(process.env.NO_PROXY).toBe("127.0.0.1")
})

test("the override is gone once that test finished", () => {
  expect(process.env.NO_PROXY).toBe(before)
})

afterAll(() => {
  expect(process.env.NO_PROXY).toBe(before)
})
