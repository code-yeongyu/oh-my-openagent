import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { ROOT_CALLS } from "../contract"
import { createOmoSdk } from ".."

const env = { OMO_SERVICE_API_URL: "https://accounts.example.test" }
const member = (root: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), root)

describe("the omo SDK root", () => {
  test("#given a root #when every call of the root type is looked up #then each is a function, with close and dispose beside them", () => {
    const root = createOmoSdk({ env, cwd: tmpdir() })
    const missing = Object.keys(ROOT_CALLS).filter((key) => typeof member(root, key) !== "function")
    expect(missing).toEqual([])
    expect(typeof root.close).toBe("function")
    expect(typeof root.dispose).toBe("function")
  })

  test("#given a call whose slice has not landed #when it runs #then it resolves not_implemented as data and never throws", async () => {
    const root = createOmoSdk({ env, cwd: tmpdir() })
    const answer = await root.sync.status()
    expect(answer).toMatchObject({ kind: "error", error: { code: "not_implemented" } })
    if (answer.kind === "error") expect(answer.error.message).toContain("sync.status")
  })

  test("#given a stream call whose slice has not landed #when it is read #then it ends with one terminal failure event", async () => {
    const root = createOmoSdk({ env, cwd: tmpdir() })
    const events: unknown[] = []
    for await (const event of root.engine.schedule.run({})) events.push(event)
    expect(events).toEqual([{ kind: "end", failure: expect.objectContaining({ code: "not_implemented" }) }])
  })

  test("#given a root #when dispose runs #then it closes the root first, so a later account call answers internal_error", async () => {
    const root = createOmoSdk({ env, cwd: tmpdir(), ports: { desktopLaunch: () => false } })
    await root.dispose()
    expect(await root.account.whoami()).toMatchObject({ kind: "error", error: { code: "internal_error" } })
  })
})
