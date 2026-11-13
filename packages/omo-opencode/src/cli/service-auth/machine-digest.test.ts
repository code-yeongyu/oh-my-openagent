import { describe, expect, test } from "bun:test"
import { normalizeHardwareId } from "@oh-my-opencode/memory-core/hardware-id"
import { advertisesMachineIdentity, machineDigestOf, readMachineDigest } from "./machine-digest"

// #6503 final contract section 2: the cross-repository machine identity. The digest vector is fixed (computed with
// shasum, not by this module), because the service and the desktop derive the same bytes.

describe("hardware id normalization", () => {
  test.each([
    ["darwin", "  0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D\n", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"],
    ["win32", "{0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D}", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"],
    ["linux", "0123456789ABCDEF0123456789abcdef\n", "0123456789abcdef0123456789abcdef"],
  ] as const)("%s normalizes to its canonical lowercase form", (platform, raw, id) => {
    expect(normalizeHardwareId(platform, raw)).toBe(id)
  })

  test.each([
    ["darwin", null],
    ["darwin", ""],
    ["darwin", "00000000-0000-0000-0000-000000000000"],
    ["darwin", "not-a-uuid"],
    ["linux", "00000000000000000000000000000000"],
    ["linux", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"],
    ["linux", "short"],
    ["freebsd", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"],
  ] as const)("%s %p yields no id, never a sentinel", (platform, raw) => {
    expect(normalizeHardwareId(platform, raw)).toBeNull()
  })
})

describe("machine digest", () => {
  test("is SHA256 of omo-machine-v1 plus the normalized id, lowercase hex", () => {
    expect(machineDigestOf("00000000-0000-4000-8000-0000000000ab")).toBe(
      "c6004b5356942c15a68eaaced0d2f27cb73c35edf985ed2f1d920b02be26f6ae",
    )
  })

  test("no validated id means no digest", async () => {
    expect(await readMachineDigest(async () => null)).toBeUndefined()
  })

  test("only the exact advertised capability enables the digest", () => {
    expect(advertisesMachineIdentity({ ok: true, capabilities: { machineIdentity: "hardware-digest-v1" } })).toBe(true)
    for (const health of [
      null,
      { ok: true },
      { capabilities: null },
      { capabilities: { machineIdentity: "hardware-digest-v2" } },
    ]) {
      expect(advertisesMachineIdentity(health)).toBe(false)
    }
  })
})
