import { describe, expect, test } from "bun:test"

import { imageFromTasklist, stillTracked } from "./process-identity"

describe("Windows QA process identity", () => {
  test("#given tasklist CSV rows #when a pid is looked up #then its image name is returned", () => {
    const csv = '"senpi-desktop-engine.exe","6348","Console","1","12,000 K"\r\n"notepad.exe","912","Console","1","9,000 K"\r\n'
    expect(imageFromTasklist(csv, 6348)).toBe("senpi-desktop-engine.exe")
    expect(imageFromTasklist(csv, 912)).toBe("notepad.exe")
    expect(imageFromTasklist(csv, 63)).toBeUndefined()
    expect(imageFromTasklist("INFO: No tasks are running which match the specified criteria.\r\n", 6348)).toBeUndefined()
  })

  test("#given a tracked engine pid #when it still runs, was recycled, or exited #then only the same image counts", () => {
    expect(stillTracked(6348, "senpi-desktop-engine.exe", () => "senpi-desktop-engine.exe")).toBe(true)
    expect(stillTracked(6348, "senpi-desktop-engine.exe", () => "svchost.exe")).toBe(false)
    expect(stillTracked(6348, "senpi-desktop-engine.exe", () => undefined)).toBe(false)
    expect(stillTracked(912, "Notepad.exe", () => "notepad.exe")).toBe(true)
  })
})
