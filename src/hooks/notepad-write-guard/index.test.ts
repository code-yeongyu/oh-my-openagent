import { describe, expect, test } from "bun:test"
import { createNotepadWriteGuardHook } from "./index"

const REFUSED_PREFIX = "Refused: Write to"

type Hook = ReturnType<typeof createNotepadWriteGuardHook>

async function invoke(
  hook: Hook,
  args: { tool: string; filePath: string },
): Promise<void> {
  await hook["tool.execute.before"]?.(
    { tool: args.tool } as never,
    { args: { filePath: args.filePath } } as never,
  )
}

describe("createNotepadWriteGuardHook", () => {
  test("#given notepad decisions.md #when write executes #then rejects with actionable error", async () => {
    const hook = createNotepadWriteGuardHook()
    await expect(
      invoke(hook, {
        tool: "write",
        filePath: ".sisyphus/notepads/foo/decisions.md",
      }),
    ).rejects.toThrow(REFUSED_PREFIX)
  })

  test("#given notepad state.json #when write executes #then rejects (entire notepad subtree blocked)", async () => {
    const hook = createNotepadWriteGuardHook()
    await expect(
      invoke(hook, {
        tool: "write",
        filePath: ".sisyphus/notepads/foo/state.json",
      }),
    ).rejects.toThrow(REFUSED_PREFIX)
  })

  test("#given regular src file #when write executes #then allows (not intercepted)", async () => {
    const hook = createNotepadWriteGuardHook()
    await expect(
      invoke(hook, {
        tool: "write",
        filePath: "src/index.ts",
      }),
    ).resolves.toBeUndefined()
  })

  test("#given non-write tool on notepad path #when executes #then allows", async () => {
    const hook = createNotepadWriteGuardHook()
    await expect(
      invoke(hook, {
        tool: "read",
        filePath: ".sisyphus/notepads/foo/decisions.md",
      }),
    ).resolves.toBeUndefined()
  })

  test("#given sisyphus plans file (not notepads) #when write executes #then allows", async () => {
    const hook = createNotepadWriteGuardHook()
    await expect(
      invoke(hook, {
        tool: "write",
        filePath: ".sisyphus/plans/my-plan.md",
      }),
    ).resolves.toBeUndefined()
  })

  test("#given absolute notepad path #when write executes #then rejects", async () => {
    const hook = createNotepadWriteGuardHook()
    await expect(
      invoke(hook, {
        tool: "write",
        filePath: "/home/user/project/.sisyphus/notepads/plan/decisions.md",
      }),
    ).rejects.toThrow(REFUSED_PREFIX)
  })

  test("#given error message #when rejected #then message names the file and gives guidance", async () => {
    const hook = createNotepadWriteGuardHook()
    const filePath = ".sisyphus/notepads/foo/decisions.md"
    let caughtMessage = ""
    try {
      await invoke(hook, { tool: "write", filePath })
    } catch (err) {
      caughtMessage = String(err)
    }
    expect(caughtMessage).toContain(filePath)
    expect(caughtMessage).toContain("append-only")
    expect(caughtMessage).toContain("Report the original Edit failure")
  })
})
