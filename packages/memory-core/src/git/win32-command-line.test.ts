import { describe, expect, test } from "bun:test"

import { quoteWindowsArgument, windowsCommandLine } from "./win32-command-line"
import { libuvQuoteCmdArg } from "./win32-command-line.test-support"

// The helper receives the command line P computes, so it must be the bytes libuv's quote_cmd_arg produces for a direct
// spawn today (design v4.2 section 6.1, row T12). The cases are the input/output pairs documented in libuv's own
// src/win/process.c, plus the empty argument and the tab that select its other two branches.
const libuvDocumentedPairs: readonly (readonly [string, string])[] = [
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
]

// Non-BMP characters are two UTF-16 code units; libuv walks and reverses the argument by code unit, so these sit next
// to each other and next to the quotes and backslashes that select the escaping branch.
const codeUnitCases: readonly string[] = [
  "",
  " ",
  "\\",
  " \\",
  "trail\\",
  "trail space\\",
  "\\\\ \\\\",
  "\u{1F600}\u{1F600}",
  "\u{1F600}\u{1F600} x",
  "\u{1F600}\u{1F600} \\",
  'x "\u{1F600}\u{1F600}"',
  '"\u{1F600}\u{1F600}"',
  '\u{1F600}"\u{1F4A9}',
  "\u{1F600}\u{1F4A9}\u{1F680} \"\\\\",
  "\u{1F600}\t\"",
  "\u{1F600} \\",
  "\\\u{1F600} x",
  '\u{1F600}"',
  '"\u{1F600} ',
  '\\"\u{1F600}\u{1F600}',
  "\u{1F600}\\\"",
]

describe("libuv quote_cmd_arg port (design v4.2 section 6.1)", () => {
  test.each(libuvDocumentedPairs)("#given %j #when quoted #then it becomes %s", (argument, quoted) => {
    expect(quoteWindowsArgument(argument)).toBe(quoted)
  })

  test.each(libuvDocumentedPairs)("#given %j #when the independent libuv port quotes it #then it becomes %s", (argument, quoted) => {
    expect(libuvQuoteCmdArg(argument)).toBe(quoted)
  })

  test("#given two adjacent emoji, a space and a trailing backslash #when the libuv port quotes it #then the pairs stay whole and the backslash doubles", () => {
    expect(libuvQuoteCmdArg("\u{1F600}\u{1F600} \\")).toBe('"\u{1F600}\u{1F600} \\\\"')
  })

  test.each(codeUnitCases)("#given %j #when quoted #then it matches libuv's code-unit algorithm", (argument) => {
    expect(quoteWindowsArgument(argument)).toBe(libuvQuoteCmdArg(argument))
  })

  test("#given argv #when joined #then each argument is quoted and separated by one space", () => {
    expect(windowsCommandLine(["git", "commit", "-m", "two words", ""])).toBe('git commit -m "two words" ""')
  })
})
