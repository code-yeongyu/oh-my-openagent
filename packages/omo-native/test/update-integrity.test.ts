import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { verifyChecksum } from "../compiled-update-download"
import { classifyInstallOwnership } from "../update-policy"

test("checksum mismatch refuses candidate bytes before execution", () => {
  const bytes = Buffer.from("candidate")
  const expected = createHash("sha256").update(bytes).digest("hex")
  expect(verifyChecksum(bytes, `${expected}  omo-linux-x64\n`, "omo-linux-x64")).toBe(expected)
  expect(() => verifyChecksum(Buffer.from("truncated"), `${expected}  omo-linux-x64\n`, "omo-linux-x64")).toThrow("checksum")
  expect(() => verifyChecksum(bytes, `${expected}  other-asset\n`, "omo-linux-x64")).toThrow("checksum")
})

test("manager-owned and failed ownership queries never authorize standalone mutation", async () => {
  const manager = await classifyInstallOwnership("/usr/bin/omo", {
    platform: "linux",
    run: async (command) => command === "dpkg-query" ? { status: 0, stdout: "omo-bin: /usr/bin/omo" } : { missing: true },
  })
  expect(manager.kind).toBe("manager-owned")
  const uncertain = await classifyInstallOwnership("/tmp/omo", {
    platform: "linux",
    run: async () => ({ error: "query timed out" }),
  })
  expect(uncertain.kind).toBe("unknown")
})
