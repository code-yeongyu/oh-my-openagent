import { describe, test, expect, mock, afterAll } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { processWithCli } from "./cli-runner"
import type { PendingCall } from "./types"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

function createMockInput() {
  return {
    session_id: "test",
    tool_name: "Write",
    transcript_path: "",
    cwd: "/tmp",
    hook_event_name: "PostToolUse",
    tool_input: { file_path: "/tmp/test.ts", content: "const x = 1" },
  }
}

function createScriptBinary(scriptContent: string): string {
  const directory = mkdtempSync(join(tmpdir(), "comment-checker-cli-test-"))
  const binaryPath = join(directory, "comment-checker")
  writeFileSync(binaryPath, scriptContent)
  chmodSync(binaryPath, 0o755)
  return binaryPath
}

afterAll(() => { mock.restore() })

describe("comment-checker CLI", () => {
  describe("lazy initialization", () => {
    test("getCommentCheckerPathSync should be lazy and callable", async () => {
      // given
      const cliModule = await import("./cli")
      // when
      const result = cliModule.getCommentCheckerPathSync()
      // then
      expect(typeof cliModule.getCommentCheckerPathSync).toBe("function")
      expect(result === null || typeof result === "string").toBe(true)
    })

    test("COMMENT_CHECKER_CLI_PATH export should not exist", async () => {
      // given
      const cliModule = await import("./cli")
      // when
      // then
      expect("COMMENT_CHECKER_CLI_PATH" in cliModule).toBe(false)
    })
  })

  describe("PATH lookup fallback (#3315)", () => {
    test("falls back to PATH when cached and package-local binaries are absent", async () => {
      // given - a real on-disk binary outside any package directory, the way
      //         `npm install -g @code-yeongyu/comment-checker` would land it
      //         in PATH but never inside our `node_modules/.../bin/`. Pre-fix
      //         the resolver returned null here and the hook silently no-op'd
      //         while doctor still reported "System OK".
      const { __resolveCommentCheckerBinaryForTesting } = await import("./cli")
      const directory = mkdtempSync(join(tmpdir(), "comment-checker-path-fallback-"))
      const pathBinary = join(directory, "comment-checker")
      writeFileSync(pathBinary, "#!/bin/sh\nexit 0\n")
      chmodSync(pathBinary, 0o755)

      try {
        // when
        const resolved = __resolveCommentCheckerBinaryForTesting(() => pathBinary)

        // then
        expect(resolved).toBe(pathBinary)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })

    test("ignores PATH binary that does not exist on disk", async () => {
      // given - `which` reports a path that's stale or rotated out
      const { __resolveCommentCheckerBinaryForTesting } = await import("./cli")

      // when
      const resolved = __resolveCommentCheckerBinaryForTesting(
        () => "/definitely/not/a/real/path/comment-checker",
      )

      // then - we never advertise a non-existent binary; runCommentChecker
      //        would otherwise spawn a missing binary and produce a confusing
      //        error instead of cleanly disabling the hook.
      expect(resolved).toBeNull()
    })

    test("treats a throwing `which` as 'not found'", async () => {
      // given - Bun.which can throw on some platforms (e.g. permission
      //         denied while traversing PATH), the resolver must not surface
      //         that as a hook crash.
      const { __resolveCommentCheckerBinaryForTesting } = await import("./cli")

      // when
      const resolved = __resolveCommentCheckerBinaryForTesting(() => {
        throw new Error("which exploded")
      })

      // then
      expect(resolved).toBeNull()
    })

    test("returns null when `which` returns null/undefined (typical not-found signal)", async () => {
      // given
      const { __resolveCommentCheckerBinaryForTesting } = await import("./cli")

      // when
      const resolvedNull = __resolveCommentCheckerBinaryForTesting(() => null)
      const resolvedUndef = __resolveCommentCheckerBinaryForTesting(() => undefined)

      // then
      expect(resolvedNull).toBeNull()
      expect(resolvedUndef).toBeNull()
    })
  })

  describe("runCommentChecker", () => {
    test("returns CheckResult shape without explicit CLI path", async () => {
      // given
      const { runCommentChecker } = await import("./cli")
      // when
      const result = await runCommentChecker(createMockInput())
      // then
      expect(typeof result.hasComments).toBe("boolean")
      expect(typeof result.message).toBe("string")
    })

    test("sends SIGKILL after grace period when process ignores SIGTERM", async () => {
      // given
      const { runCommentChecker } = await import("./cli")
      const binaryPath = createScriptBinary(`#!/bin/sh
if [ "$1" != "check" ]; then
  exit 1
fi
trap '' TERM
while :; do
  :
done
`)
      const originalSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number) => {
        fn()
        return unsafeTestValue<ReturnType<typeof setTimeout>>(0)
      }) as typeof setTimeout

      try {
        // when
        const result = await runCommentChecker(createMockInput(), binaryPath)
        // then
        expect(result).toEqual({ hasComments: false, message: "" })
      } finally {
        globalThis.setTimeout = originalSetTimeout
      }
    })

    test("returns empty result on timeout", async () => {
      // given
      const { runCommentChecker } = await import("./cli")
      const binaryPath = createScriptBinary(`#!/bin/sh
if [ "$1" != "check" ]; then
  exit 1
fi
trap '' TERM
while :; do
  :
done
`)
      const originalSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number) => {
        fn()
        return unsafeTestValue<ReturnType<typeof setTimeout>>(0)
      }) as typeof setTimeout

      try {
        // when
        const result = await runCommentChecker(createMockInput(), binaryPath)
        // then
        expect(result).toEqual({ hasComments: false, message: "" })
      } finally {
        globalThis.setTimeout = originalSetTimeout
      }
    })

    test("keeps non-timeout flow unchanged", async () => {
      // given
      const { runCommentChecker } = await import("./cli")
      const binaryPath = createScriptBinary(`#!/bin/sh
if [ "$1" != "check" ]; then
  exit 1
fi
cat >/dev/null
echo "found comments" 1>&2
exit 2
`)
      // when
      const result = await runCommentChecker(createMockInput(), binaryPath)
      // then
      expect(result).toEqual({ hasComments: true, message: "found comments\n" })
    })
  })

  describe("processWithCli semaphore", () => {
    test("skips second concurrent processWithCli call", async () => {
      // given
      let callCount = 0
      let resolveFirst = () => {}
      const firstCallPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      const cliMockFactory = () => ({
        runCommentChecker: mock(async () => {
          callCount += 1
          if (callCount === 1) {
            await firstCallPromise
          }
          return { hasComments: false, message: "" }
        }),
        getCommentCheckerPath: mock(async () => "/fake"),
        startBackgroundInit: mock(() => {}),
      })
      const cliMocks = cliMockFactory()
      const pendingCall: PendingCall = {
        tool: "write",
        sessionID: "ses-1",
        filePath: "/tmp/a.ts",
        timestamp: Date.now(),
      }
      const firstCall = processWithCli({ tool: "write", sessionID: "ses-1", callID: "call-1" }, pendingCall, { output: "" }, "/fake", undefined, () => {}, { runCommentChecker: cliMocks.runCommentChecker })
      const secondCall = processWithCli({ tool: "write", sessionID: "ses-2", callID: "call-2" }, pendingCall, { output: "" }, "/fake", undefined, () => {}, { runCommentChecker: cliMocks.runCommentChecker })

      // when
      await secondCall
      resolveFirst()
      await firstCall
      // then
      expect(callCount).toBe(1)
    })

    test("allows second call after first call completes", async () => {
      // given
      let callCount = 0
      const cliMockFactory = () => ({
        runCommentChecker: mock(async () => {
          callCount += 1
          return { hasComments: false, message: "" }
        }),
        getCommentCheckerPath: mock(async () => "/fake"),
        startBackgroundInit: mock(() => {}),
      })
      const cliMocks = cliMockFactory()
      const pendingCall: PendingCall = {
        tool: "write",
        sessionID: "ses-1",
        filePath: "/tmp/a.ts",
        timestamp: Date.now(),
      }
      // when
      await processWithCli({ tool: "write", sessionID: "ses-1", callID: "call-1" }, pendingCall, { output: "" }, "/fake", undefined, () => {}, { runCommentChecker: cliMocks.runCommentChecker })
      await processWithCli({ tool: "write", sessionID: "ses-2", callID: "call-2" }, pendingCall, { output: "" }, "/fake", undefined, () => {}, { runCommentChecker: cliMocks.runCommentChecker })
      // then
      expect(callCount).toBe(2)
    })
  })
})
