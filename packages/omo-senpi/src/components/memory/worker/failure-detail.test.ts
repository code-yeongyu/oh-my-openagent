import { describe, expect, test } from "bun:test"

import { childFailureCause, failureFingerprint, FAILURE_CAUSE_MAX_CHARS } from "./failure-detail"

const BUN_CRASH_STDERR = [
  '340 |         const darkPath = path.join(themesDir, "dark.json");',
  '345 |             dark: JSON.parse(fs.readFileSync(darkPath, "utf-8")),',
  "                                      ^",
  "ENOENT: no such file or directory, open '/opt/omo-runtime/dist/modes/interactive/theme/dark.json'",
  '    path: "/opt/omo-runtime/dist/modes/interactive/theme/dark.json",',
  '  syscall: "open",',
  "    errno: -2,",
  '     code: "ENOENT"',
  "",
  "      at getBuiltinThemes (/global/senpi/dist/modes/interactive/theme/theme.js:345:33)",
  "      at loadTheme (/global/senpi/dist/modes/interactive/theme/theme.js:513:23)",
  "",
  "Bun v1.4.2 (macOS arm64)",
].join("\n")

describe("childFailureCause", () => {
  test("#given a Bun crash tail #when the cause is distilled #then only the message line survives", () => {
    // when
    const cause = childFailureCause(BUN_CRASH_STDERR)

    // then
    expect(cause).toBe(
      "ENOENT: no such file or directory, open '/opt/omo-runtime/dist/modes/interactive/theme/dark.json'",
    )
  })

  test("#given a detail that is already one sentence #when it is distilled #then it survives unchanged", () => {
    // when / then
    expect(childFailureCause("memory run supervisor exited with 143")).toBe("memory run supervisor exited with 143")
  })

  test("#given a named error below a truncation marker #when it is distilled #then the marker is dropped", () => {
    // given
    const detail = ["[truncated to last 65536 bytes]", "TypeError: undefined is not a function"].join("\n")

    // when / then
    expect(childFailureCause(detail)).toBe("TypeError: undefined is not a function")
  })

  test("#given prose above a named error #when it is distilled #then the named error wins over line order", () => {
    // given
    const detail = ["Resolving the model catalog", "Error: Model \"fake/one\" not found."].join("\n")

    // when / then
    expect(childFailureCause(detail)).toBe('Error: Model "fake/one" not found.')
  })

  test("#given only machinery #when it is distilled #then there is no cause to show", () => {
    // given
    const detail = ['345 |   dark: JSON.parse(x),', "      ^", "  at loadTheme (theme.js:513:23)", "Bun v1.4.2 (macOS arm64)"].join("\n")

    // when / then
    expect(childFailureCause(detail)).toBeUndefined()
  })

  test("#given an empty or absent detail #when it is distilled #then nothing is invented", () => {
    // when / then
    expect(childFailureCause(undefined)).toBeUndefined()
    expect(childFailureCause("")).toBeUndefined()
    expect(childFailureCause("   \n\t\n")).toBeUndefined()
  })

  test("#given a pathological single line #when it is distilled #then it is bounded", () => {
    // given
    const detail = `Error: ${"x".repeat(FAILURE_CAUSE_MAX_CHARS * 2)}`

    // when
    const cause = childFailureCause(detail) ?? ""

    // then
    expect(cause).toHaveLength(FAILURE_CAUSE_MAX_CHARS)
    expect(cause.endsWith("…")).toBe(true)
  })
})

describe("failureFingerprint", () => {
  test("#given a crash tail #when the fingerprint is built #then it keys on the cause, not the code frame", () => {
    // when
    const fingerprint = failureFingerprint("child_exit", BUN_CRASH_STDERR)

    // then
    expect(fingerprint).not.toMatch(/\d+\s\|\s/)
    expect(fingerprint).toBe("child_exit:ENOENT: no such file or directory, open '/opt/omo-runtime/di")
  })

  test("#given the same crash one source line later #when both are fingerprinted #then the streak stays one failure", () => {
    // given
    const shifted = BUN_CRASH_STDERR.replace("340 |", "341 |").replace("345 |", "346 |")

    // when / then
    expect(failureFingerprint("child_exit", shifted)).toBe(failureFingerprint("child_exit", BUN_CRASH_STDERR))
  })

  test("#given no reason and no detail #when the fingerprint is built #then it degrades to the failed key", () => {
    // when / then
    expect(failureFingerprint(undefined, undefined)).toBe("failed:")
  })
})
