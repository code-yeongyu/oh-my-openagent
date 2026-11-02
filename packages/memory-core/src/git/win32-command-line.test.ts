import { describe, expect, test } from "bun:test"

import { quoteWindowsArgument, windowsCommandLine } from "./win32-command-line"

// The helper receives the command line P computes, so it must be the bytes libuv's quote_cmd_arg produces for a direct
// spawn today (design v4.2 section 6.1, row T12). The cases are the input/output pairs documented in libuv's own
// src/win/process.c, plus the empty argument and the tab that select its other two branches.
describe("libuv quote_cmd_arg port (design v4.2 section 6.1)", () => {
  test.each([
    ["", '""'],
    ["hello", "hello"],
    ["hello world", '"hello world"'],
    ["tab\there", '"tab\there"'],
    ['hello"world', '"hello\\"world"'],
    ['hello""world', '"hello\\"\\"world"'],
    ["hello\\world", "hello\\world"],
    ["hello\\\\world", "hello\\\\world"],
    ['hello\\"world', '"hello\\\\\\"world"'],
    ['hello\\\\"world', '"hello\\\\\\\\\\"world"'],
    ["hello world\\", '"hello world\\\\"'],
  ])("#given %j #when quoted #then it becomes %s", (argument, quoted) => {
    expect(quoteWindowsArgument(argument)).toBe(quoted)
  })

  test("#given argv #when joined #then each argument is quoted and separated by one space", () => {
    expect(windowsCommandLine(["git", "commit", "-m", "two words", ""])).toBe('git commit -m "two words" ""')
  })
})
