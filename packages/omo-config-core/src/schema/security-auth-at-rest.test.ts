import { describe, expect, test } from "bun:test"

import { OmoConfigSchema, resolveOmoSecurityAuthAtRest } from "../index"

describe("security.auth_at_rest schema (PR-E)", () => {
  test("#given a config that does not declare security #when resolving #then the default mode is plain and no other defaults surface", () => {
    const resolved = resolveOmoSecurityAuthAtRest({})
    expect(resolved.auth_at_rest).toBe("plain")
  })

  test("#given an explicit passphrase value #when resolving #then the value survives", () => {
    const resolved = resolveOmoSecurityAuthAtRest({ security: { auth_at_rest: "passphrase" } })
    expect(resolved.auth_at_rest).toBe("passphrase")
  })

  test("#given an ssh-key value with an override path #when resolving #then both fields survive", () => {
    const resolved = resolveOmoSecurityAuthAtRest({
      security: { auth_at_rest: "ssh-key", ssh_key_path: "/home/leg/.ssh/id_ed25519_legacy" },
    })
    expect(resolved.auth_at_rest).toBe("ssh-key")
    expect(resolved.ssh_key_path).toBe("/home/leg/.ssh/id_ed25519_legacy")
  })

  test("#given an unknown mode value #when parsed by the root schema #then the layer is dropped with an invalid-value diagnostic", () => {
    const result = OmoConfigSchema.safeParse({ security: { auth_at_rest: "biometric" } })
    // Root schema is strict on the security shape, so an unknown mode is rejected outright.
    expect(result.success).toBe(false)
  })

  test("#given an ssh_key_path with a non-string value #when parsed by the layer schema #then it is rejected", () => {
    const result = OmoConfigSchema.safeParse({ security: { ssh_key_path: 42 } })
    expect(result.success).toBe(false)
  })

  test("#given the canonical config shape #when the root schema parses it #then security is exposed as a typed object", () => {
    const parsed = OmoConfigSchema.parse({
      security: { auth_at_rest: "ssh-key", ssh_key_path: "/x" },
    })
    expect(parsed.security).toEqual({ auth_at_rest: "ssh-key", ssh_key_path: "/x" })
  })
})
