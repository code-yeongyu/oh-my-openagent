import { describe, expect, test } from "bun:test"
import {
  classifyCmuxEndpoint,
  isConnectionRefusedText,
  supportsCmuxNotifyFlagModel,
} from "./tmux-path-resolver"

describe("tmux-path-resolver cmux endpoint helpers", () => {
  test("classifies relay host:port endpoint as relay", () => {
    expect(classifyCmuxEndpoint("127.0.0.1:7788")).toBe("relay")
  })

  test("classifies unix socket path as unix", () => {
    expect(classifyCmuxEndpoint("/tmp/cmux.sock")).toBe("unix")
  })

  test("classifies empty endpoint as missing", () => {
    expect(classifyCmuxEndpoint("   ")).toBe("missing")
  })

  test("detects connection refused text", () => {
    expect(isConnectionRefusedText("connect: connection refused")).toBe(true)
    expect(isConnectionRefusedText("ECONNREFUSED while connecting")).toBe(true)
    expect(isConnectionRefusedText("permission denied")).toBe(false)
  })

  test("accepts cmux notify help output with title/body model", () => {
    const help = `
cmux notify

Flags:
  --title <text>
  --body <text>
`

    expect(supportsCmuxNotifyFlagModel(help)).toBe(true)
  })

  test("rejects legacy message-based notify flag model", () => {
    const legacyHelp = `
cmux notify

Flags:
  --title <text>
  --message <text>
`

    expect(supportsCmuxNotifyFlagModel(legacyHelp)).toBe(false)
  })
})
