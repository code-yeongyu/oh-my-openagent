import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { createStartWorkHook } from "./index"
import { clearBoulderState, readBoulderState } from "../../features/boulder-state"

describe("start-work runtime context", () => {
  let testDir: string

  const createHook = (directory: string) =>
    createStartWorkHook({
      directory,
      client: {},
    } as Parameters<typeof createStartWorkHook>[0])

  beforeEach(() => {
    testDir = join(tmpdir(), `start-work-runtime-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    clearBoulderState(testDir)
  })

  afterEach(() => {
    clearBoulderState(testDir)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("prefers message.path.cwd over plugin directory for plan discovery", async () => {
    const wrongDirectory = join(testDir, "wrong-context")
    mkdirSync(wrongDirectory, { recursive: true })

    const planDir = join(testDir, "changes", "runtime-plan")
    mkdirSync(planDir, { recursive: true })
    writeFileSync(join(planDir, "tasks.md"), "# Runtime Plan\n- [ ] Task 1")

    const hook = createHook(wrongDirectory)
    const output = {
      message: { path: { cwd: testDir, root: testDir } },
      parts: [{ type: "text", text: "<session-context></session-context>" }],
    }

    await hook["chat.message"]({ sessionID: "session-123" }, output)

    expect(output.parts[0].text).toContain("Auto-Selected Plan")
    expect(output.parts[0].text).toContain("runtime-plan")
    expect(readBoulderState(testDir)?.plan_name).toBe("runtime-plan")
    expect(readBoulderState(wrongDirectory)).toBeNull()
  })

  test("removes unresolved argument placeholders before context injection", async () => {
    const planDir = join(testDir, "changes", "placeholder-plan")
    mkdirSync(planDir, { recursive: true })
    writeFileSync(join(planDir, "tasks.md"), "# Placeholder Plan\n- [ ] Task 1")

    const hook = createHook(testDir)
    const output = {
      message: { path: { cwd: testDir, root: testDir } },
      parts: [
        {
          type: "text",
          text: `<session-context>\n<user-request>$ARGUMENTS</user-request>\n</session-context>`,
        },
      ],
    }

    await hook["chat.message"]({ sessionID: "session-456" }, output)

    expect(output.parts[0].text).not.toContain("$ARGUMENTS")
    expect(output.parts[0].text).not.toContain("${user_message}")
    expect(output.parts[0].text).toContain("Auto-Selected Plan")
    expect(output.parts[0].text).toContain("placeholder-plan")
  })
})
