import { describe, expect, test } from "bun:test"

import { resolveParentDirectory } from "./parent-directory-resolver"

describe("background-agent parent-directory-resolver", () => {
  const originalPlatform = process.platform

  test("uses current working directory on Windows when parent session directory is AppData", async () => {
    //#given
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      const client = {
        session: {
          get: async () => ({
            data: { directory: "C:\\Users\\test\\AppData\\Local\\ai.opencode.desktop" },
          }),
        },
      }

      //#when
      const result = await resolveParentDirectory({
        client: client as Parameters<typeof resolveParentDirectory>[0]["client"],
        parentSessionID: "ses_parent",
        defaultDirectory: "C:\\Users\\test\\AppData\\Roaming\\opencode",
      })

      //#then
      expect(result).toBe(process.cwd())
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform })
    }
  })
})
