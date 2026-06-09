import { describe, expect, test } from "bun:test"

import { isWindowsAppDataDirectory, resolveSessionDirectory } from "./session-directory-resolver"

describe("session-directory-resolver", () => {
  describe("isWindowsAppDataDirectory", () => {
    test("returns true when path is under AppData Local", () => {
      //#given
      const directory = "C:/Users/test/AppData/Local/opencode"

      //#when
      const result = isWindowsAppDataDirectory(directory)

      //#then
      expect(result).toBe(true)
    })

    test("returns true when path ends with AppData directory segment", () => {
      //#given
      const directory = "C:/Users/test/AppData/Local"

      //#when
      const result = isWindowsAppDataDirectory(directory)

      //#then
      expect(result).toBe(true)
    })

    test("returns false when path is outside AppData", () => {
      //#given
      const directory = "D:/projects/oh-my-opencode"

      //#when
      const result = isWindowsAppDataDirectory(directory)

      //#then
      expect(result).toBe(false)
    })

    test("returns false for lookalike non-AppData segment", () => {
      //#given
      const directory = "D:/projects/appdata/local-tools"

      //#when
      const result = isWindowsAppDataDirectory(directory)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("resolveSessionDirectory", () => {
    test("uses process working directory on Windows when parent directory drifts to AppData", () => {
      //#given
      const options = {
        parentDirectory: "C:\\Users\\test\\AppData\\Local\\ai.opencode.desktop",
        fallbackDirectory: "C:\\Users\\test\\AppData\\Roaming\\opencode",
        platform: "win32" as const,
        currentWorkingDirectory: "D:\\projects\\oh-my-opencode",
      }

      //#when
      const result = resolveSessionDirectory(options)

      //#then
      expect(result).toBe("D:\\projects\\oh-my-opencode")
    })

    test("keeps AppData directory when current working directory is also AppData", () => {
      //#given
      const options = {
        parentDirectory: "C:\\Users\\test\\AppData\\Local\\ai.opencode.desktop",
        fallbackDirectory: "C:\\Users\\test\\AppData\\Roaming\\opencode",
        platform: "win32" as const,
        currentWorkingDirectory: "C:\\Users\\test\\AppData\\Local\\Temp",
      }

      //#when
      const result = resolveSessionDirectory(options)

      //#then
      expect(result).toBe("C:\\Users\\test\\AppData\\Local\\ai.opencode.desktop")
    })

    test("keeps original directory outside Windows", () => {
      //#given
      const options = {
        parentDirectory: "/tmp/opencode",
        fallbackDirectory: "/workspace/project",
        platform: "darwin" as const,
        currentWorkingDirectory: "/workspace/project",
      }

      //#when
      const result = resolveSessionDirectory(options)

      //#then
      expect(result).toBe("/tmp/opencode")
    })
  })
})
