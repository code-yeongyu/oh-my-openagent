import { expect, test } from "bun:test"
import { PassThrough } from "node:stream"

import { terminalFromStreams } from "../sync-phrase-tty"

const settled = <T>(promise: Promise<T>): Promise<T | "still-pending"> => {
  const deadline = Promise.withResolvers<"still-pending">()
  const timer = setTimeout(() => deadline.resolve("still-pending"), 2_000)
  return Promise.race([promise, deadline.promise]).finally(() => clearTimeout(timer))
}

for (const [label, end] of [
  ["Ctrl+D", (input: PassThrough) => void input.write("\u0004")],
  ["Ctrl+C", (input: PassThrough) => void input.write("\u0003")],
  ["end of input (EOF)", (input: PassThrough) => void input.end()],
  ["a stream error", (input: PassThrough) => void input.destroy(new Error("terminal went away"))],
] as const) {
  test(`#given a pending secret read #when the terminal sends ${label} #then the read resolves null instead of hanging`, async () => {
    const input = new PassThrough()
    const written: string[] = []
    const terminal = terminalFromStreams(input, { write: (text: string) => written.push(text) })
    const pending = terminal.readLine(true)
    end(input)
    expect(await settled(pending)).toBeNull()
    expect(await settled(terminal.readLine(true))).toBeNull()
  })
}

test("#given a secret read #when a line is typed #then it is returned and nothing typed is echoed", async () => {
  const input = new PassThrough()
  const written: string[] = []
  const terminal = terminalFromStreams(input, { write: (text: string) => written.push(text) })
  const pending = terminal.readLine(true)
  input.write("abandon ability\r")
  expect(await settled(pending)).toBe("abandon ability")
  expect(written.join("")).not.toContain("abandon")
})
