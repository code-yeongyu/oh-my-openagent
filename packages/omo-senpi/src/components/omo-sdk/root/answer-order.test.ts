import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { assembleOmoSdk } from "../assembly"
import type { OmoPrincipal } from "../contract"

// The order of answers at the root (design 4.4, amendments): the principal's line first, then the input, then
// availability, then the port. engine.launch.print is unbuilt here and refused to a connector by its line.
const root = (principal: OmoPrincipal) =>
  assembleOmoSdk({ cwd: tmpdir(), agentDir: tmpdir(), principal, ports: { desktopLaunch: () => false } }, {})

const codeOf = async (answer: unknown): Promise<unknown> => {
  const settled = await answer
  if (typeof settled === "object" && settled !== null && Symbol.asyncIterator in settled) {
    for await (const event of settled as AsyncIterable<{ kind?: string; failure?: { code?: string } }>)
      if (event.kind === "end") return event.failure?.code
    return undefined
  }
  return (settled as { error?: { code?: string } }).error?.code
}

describe("the order of answers at the root", () => {
  test("#given a refused pair on an unbuilt call #then it answers sender_not_allowed, not not_implemented", async () => {
    expect(await codeOf(root({ kind: "connector", binding: "b-1" }).install.version({}))).toBe("sender_not_allowed")
  })

  test("#given an admitted pair on an unbuilt call with an invalid input #then it answers the input refusal, not not_implemented", async () => {
    const script = root({ kind: "script", uid: 501 })
    expect(await codeOf(script.install.version("not an object" as never))).toBe("invalid_arguments")
    expect(await codeOf(script.install.version({}))).toBe("not_implemented")
  })
})
