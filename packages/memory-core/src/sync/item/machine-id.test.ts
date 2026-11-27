import { describe, expect, test } from "bun:test"
import { readHardwareId } from "./machine-id"

const LINUX_ID = "0123456789abcdef0123456789abcdef"
const DBUS_ID = "abcdef0123456789abcdef0123456789"

function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe("readHardwareId linux sources", () => {
  test("#given /etc/machine-id cannot be read #when the dbus id is valid #then that id is used", async () => {
    const seen: string[] = []
    const read = async (path: string, _encoding: "utf8") => {
      seen.push(path)
      if (path === "/etc/machine-id") throw errno("EACCES")
      return `${DBUS_ID}\n`
    }
    expect(await readHardwareId("linux", read)).toBe(DBUS_ID)
    expect(seen).toEqual(["/etc/machine-id", "/var/lib/dbus/machine-id"])
  })

  test("#given /etc/machine-id is missing and dbus also fails #when the id is read #then there is no sentinel", async () => {
    const read = async (path: string, _encoding: "utf8") => {
      throw errno(path === "/etc/machine-id" ? "ENOENT" : "EIO")
    }
    expect(await readHardwareId("linux", read)).toBeNull()
  })

  test("#given /etc/machine-id is readable #when the id is read #then dbus is not opened", async () => {
    const seen: string[] = []
    const read = async (path: string, _encoding: "utf8") => {
      seen.push(path)
      return LINUX_ID
    }
    expect(await readHardwareId("linux", read)).toBe(LINUX_ID)
    expect(seen).toEqual(["/etc/machine-id"])
  })
})
