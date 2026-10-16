import { describe, expect, test } from "bun:test"

import { shellQuote } from "./shell-quote"

describe("shellQuote", () => {
  test("#given a plain path #when quoted #then it is wrapped in single quotes", () => {
    expect(shellQuote("/home/u/runtime")).toBe("'/home/u/runtime'")
  })

  test("#given a path with a single quote #when quoted #then the quote is closed, escaped and reopened", () => {
    expect(shellQuote("/home/u/it's dir")).toBe("'/home/u/it'\\''s dir'")
  })

  test("#given a path with a single quote #when the quoted form is run by sh #then sh sees the original path", async () => {
    // given
    const path = "/home/u/it's a $HOME `dir`"

    // when
    const proc = Bun.spawn(["sh", "-c", `printf %s ${shellQuote(path)}`], { stdout: "pipe" })
    const out = await new Response(proc.stdout).text()
    await proc.exited

    // then
    expect(out).toBe(path)
  })
})
