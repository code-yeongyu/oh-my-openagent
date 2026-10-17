import { describe, expect, it } from "bun:test"
import { normalizeHost, scopeViolation, checkPathScope } from "./scope-guard"
import type { MissionScope } from "./types"

describe("normalizeHost", () => {
  it("#given URL with www prefix -> #when normalize -> #then strips www and extracts hostname", () => {
    // given
    const input = "https://www.example.com/path"

    // when
    const result = normalizeHost(input)

    // then
    expect(result).toBe("example.com")
  })

  it("#given CIDR notation -> #when normalize -> #then strips mask", () => {
    // given
    const input = "10.0.0.0/24"

    // when
    const result = normalizeHost(input)

    // then
    expect(result).toBe("10.0.0.0")
  })

  it("#given bare host -> #when normalize -> #then returns lowercased host", () => {
    // given
    const input = "EXAMPLE.COM"

    // when
    const result = normalizeHost(input)

    // then
    expect(result).toBe("example.com")
  })

  it("#given schemeless host:port -> #when normalize -> #then extracts hostname", () => {
    // given
    const input = "target.example.com:3000"

    // when
    const result = normalizeHost(input)

    // then
    expect(result).toBe("target.example.com")
  })

  it("#given IPv6 loopback URL -> #when normalize -> #then strips brackets", () => {
    // given
    const input = "http://[::1]:3000"

    // when
    const result = normalizeHost(input)

    // then
    expect(result).toBe("::1")
  })
})

describe("scopeViolation", () => {
  const scope: MissionScope = {
    allowed_hosts: [{ host: "target.example.com" }],
    allowed_paths: [],
    allow_loopback: false,
    allow_private: false,
  }

  it("#given allowed host -> #when check -> #then returns null", () => {
    // given
    const host = "target.example.com"

    // when
    const violation = scopeViolation(scope, host)

    // then
    expect(violation).toBeNull()
  })

  it("#given off-scope host -> #when check -> #then returns violation message", () => {
    // given
    const host = "evil.example.com"

    // when
    const violation = scopeViolation(scope, host)

    // then
    expect(violation).toContain("not in allowed scope")
  })

  it("#given loopback without allow -> #when check -> #then returns violation", () => {
    // given
    const host = "127.0.0.1"

    // when
    const violation = scopeViolation(scope, host)

    // then
    expect(violation).toContain("loopback")
  })

  it("#given loopback with allow -> #when check -> #then returns null", () => {
    // given
    const allowLoopbackScope: MissionScope = { ...scope, allow_loopback: true }

    // when
    const violation = scopeViolation(allowLoopbackScope, "localhost")

    // then
    expect(violation).toBeNull()
  })

  it("#given IPv6 loopback with allow -> #when check -> #then returns null", () => {
    // given
    const allowLoopbackScope: MissionScope = { ...scope, allow_loopback: true }

    // when
    const violation = scopeViolation(allowLoopbackScope, "[::1]")

    // then
    expect(violation).toBeNull()
  })

  it("#given private host without allow -> #when check -> #then returns violation", () => {
    // given
    const host = "192.168.1.1"

    // when
    const violation = scopeViolation(scope, host)

    // then
    expect(violation).toContain("private")
  })

  it("#given CIDR mask-strip attempt -> #when check -> #then denies off-scope", () => {
    // given
    const host = "10.0.0.0/0"

    // when
    const violation = scopeViolation(scope, host)

    // then
    expect(violation).not.toBeNull()
  })
})

describe("checkPathScope", () => {
  it("#given empty allowed_paths -> #when check -> #then returns null", () => {
    // given
    const scope: MissionScope = {
      allowed_hosts: [],
      allowed_paths: [],
      allow_loopback: false,
      allow_private: false,
    }

    // when
    const result = checkPathScope(scope, "/any/path")

    // then
    expect(result).toBeNull()
  })

  it("#given path in allowed list -> #when check -> #then returns null", () => {
    // given
    const scope: MissionScope = {
      allowed_hosts: [],
      allowed_paths: ["/repo/src"],
      allow_loopback: false,
      allow_private: false,
    }

    // when
    const result = checkPathScope(scope, "/repo/src/file.ts")

    // then
    expect(result).toBeNull()
  })

  it("#given path outside allowed list -> #when check -> #then returns violation", () => {
    // given
    const scope: MissionScope = {
      allowed_hosts: [],
      allowed_paths: ["/repo/src"],
      allow_loopback: false,
      allow_private: false,
    }

    // when
    const result = checkPathScope(scope, "/etc/passwd")

    // then
    expect(result).toContain("not in allowed scope")
  })

  it("#given path traversal attempt -> #when check -> #then returns violation", () => {
    // given
    const scope: MissionScope = {
      allowed_hosts: [],
      allowed_paths: ["/safe"],
      allow_loopback: false,
      allow_private: false,
    }

    // when
    const result = checkPathScope(scope, "/safe/../secret")

    // then
    expect(result).toContain("traversal")
  })
})
