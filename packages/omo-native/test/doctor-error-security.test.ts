import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { doctorComputerUseLines } from "../bin/lib/computer-use-doctor.js"
import { gatewayDoctorLines } from "../bin/lib/gateway.js"

const secret = "sk-test-DO-NOT-PRINT-0000"
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test("computer use doctor does not echo an exception containing config data", async () => {
  const lines = await doctorComputerUseLines({ loadRuntime: async () => { throw new Error(secret) } })
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.join("\n")).not.toContain(secret)
})

for (const duringImport of [true, false]) {
  test(`gateway doctor hides config data thrown during ${duringImport ? "import" : "checks"}`, async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-gateway-secret-"))
    roots.push(home)
    mkdirSync(join(home, ".omo"))
    writeFileSync(join(home, ".omo", "omo.jsonc"), '{"gateway":{}}')
    const lines = await gatewayDoctorLines({
      env: { HOME: home },
      importHost: async () => {
        if (duringImport) throw new Error(secret)
        return {
          HOST_CONTRACT_VERSION: 1,
          gatewayDoctorLines: async () => { throw new Error(secret) },
        }
      },
    })
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join("\n")).not.toContain(secret)
  })
}
