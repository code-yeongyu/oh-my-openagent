import { afterEach, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { materializeProvisionedExecutable } from "../compile-runtime"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

test("concurrent provisioners sharing a PID cannot consume each other's temporary executable", () => {
  // given: workers (or separate PID namespaces) can share a PID and destination.
  const root = fs.mkdtempSync(join(tmpdir(), "omo-provision-race-"))
  roots.push(root)
  const source = join(root, "source")
  const destination = join(root, "omo")
  fs.writeFileSync(source, "complete executable\n")
  const copyFile = fs.copyFileSync
  let competing = false
  const copy = spyOn(fs, "copyFileSync").mockImplementation((from, to, flags) => {
    copyFile(from, to, flags)
    if (!competing) {
      competing = true
      materializeProvisionedExecutable(source, destination, "linux")
    }
  })

  // when: the second provisioner publishes after the first copies, before chmod.
  try {
    expect(() => materializeProvisionedExecutable(source, destination, "linux")).not.toThrow()
  } finally {
    copy.mockRestore()
  }

  // then: both complete, and the published executable is ready to execute.
  expect(competing).toBe(true)
  expect(fs.readFileSync(destination, "utf8")).toBe("complete executable\n")
  if (process.platform !== "win32") expect(fs.statSync(destination).mode & 0o777).toBe(0o755)
  expect(fs.readdirSync(root).sort()).toEqual(["omo", "source"])
})
