import { describe, expect, test } from "bun:test"

import { sanitizeTerminalText } from "./sanitize"

describe("sanitizeTerminalText", () => {
  test("#given plain text #when sanitized #then it is unchanged", () => {
    expect(sanitizeTerminalText("src/app.ts  +1/-2 · ok")).toBe("src/app.ts  +1/-2 · ok")
  })

  test("#given a file name carrying its own colour sequence #when sanitized #then it cannot recolour the row", () => {
    expect(sanitizeTerminalText("evil\u001b[31mRED.txt")).toBe("evil[31mRED.txt")
  })

  test("#given a file name carrying an OSC 8 link and BEL #when sanitized #then no ESC or BEL survives", () => {
    const hostile = "evil\u001b]8;;https://x\u0007click\u001b]8;;\u0007.txt"
    const clean = sanitizeTerminalText(hostile)
    expect(clean).not.toContain("\u001b")
    expect(clean).not.toContain("\u0007")
    expect(clean).toBe("evil]8;;https://xclick]8;;.txt")
  })

  test("#given a cursor or screen command #when sanitized #then its ESC is dropped", () => {
    expect(sanitizeTerminalText("a\u001b[2Jb\u001b[Hc")).toBe("a[2Jb[Hc")
  })

  test("#given line breaks and tabs #when sanitized #then each becomes one space", () => {
    expect(sanitizeTerminalText("line one\nline two\r\n\tend")).toBe("line one line two   end")
  })

  test("#given C1 controls and DEL #when sanitized #then they are removed", () => {
    expect(sanitizeTerminalText("a\u009b2Jb\u007fc\u0090d")).toBe("a2Jbcd")
  })

  test("#given an unterminated SGR at the end #when sanitized #then the ESC is dropped", () => {
    expect(sanitizeTerminalText("tail\u001b[31")).toBe("tail[31")
  })
})
