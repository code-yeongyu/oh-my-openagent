import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

// Regression guard for issue #6142 (flaky fixEmptyMessagesWithSDK on ubuntu CI).
//
// bun runs every test file in one process. message-builder.test.ts used to
// register mock.module for "./storage/empty-text" and
// "./storage/text-part-injector" (each twice: with and without the .ts
// extension, because bun mock-key normalization is inconsistent) - exactly the
// specifier graph that empty-content-recovery-sdk.ts depends on. Whether a
// given evaluation of that graph captured real or mocked bindings depended on
// file load ordering under full-suite load, which is what intermittently broke
// fixEmptyMessagesWithSDK on identical heads.
//
// The fix gives sanitizeEmptyMessagesBeforeSummarize injectable storage deps,
// so message-builder tests need no module mocks at all. This test pins that no
// test file in this directory ever re-registers mocks against the SDK victim's
// dependency specifiers.

const DIR = import.meta.dir

const VICTIM_DEPENDENCY_SPECIFIERS = [
  "./storage/empty-text",
  "./storage/empty-text.ts",
  "./storage/text-part-injector",
  "./storage/text-part-injector.ts",
]

async function listTestFiles(): Promise<string[]> {
  const entries = await readdir(DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => path.join(DIR, entry.name))
    .sort()
}

function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")
}

describe("anthropic-context-window-limit-recovery test isolation regression (#6142)", () => {
  test("#given every test file in this hook dir #when scanned #then no file module-mocks the empty-content-recovery-sdk dependency specifiers", async () => {
    // given
    const files = await listTestFiles()
    expect(files.length).toBeGreaterThan(0)

    // when
    const offenders: Array<{ file: string; specifier: string }> = []
    for (const filePath of files) {
      const source = stripLineComments(await readFile(filePath, "utf8"))
      for (const specifier of VICTIM_DEPENDENCY_SPECIFIERS) {
        if (source.includes(`mock.module("${specifier}"`)) {
          offenders.push({ file: path.relative(DIR, filePath), specifier })
        }
      }
    }

    // then
    expect(offenders).toEqual([])
  })
})
