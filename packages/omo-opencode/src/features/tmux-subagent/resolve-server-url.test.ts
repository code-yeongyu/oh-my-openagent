/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { resolveServerTarget, resolveServerUrl } from "./resolve-server-url"

const noopLog = (): void => undefined

describe("resolveServerTarget", () => {
  it("trusts a valid noncanonical current context URL", () => {
    expect(resolveServerTarget("https://127.0.0.1:7443/root", {}, noopLog)).toEqual({
      serverUrl: "https://127.0.0.1:7443/root",
      source: "current-context",
      trusted: true,
    })
  })

  it("lets a valid noncanonical current context URL win over an explicit port", () => {
    expect(resolveServerTarget(
      "http://127.0.0.1:7443/",
      { OPENCODE_PORT: "5317" },
      noopLog,
    )).toEqual({
      serverUrl: "http://127.0.0.1:7443/",
      source: "current-context",
      trusted: true,
    })
  })

  it("treats the canonical SDK URL as a synthetic anonymous fallback", () => {
    expect(resolveServerTarget("http://localhost:4096/", {}, noopLog)).toEqual({
      serverUrl: "http://localhost:4096",
      source: "synthetic-fallback",
      trusted: false,
    })
  })

  it("lets a strict explicit port replace the canonical SDK fallback", () => {
    expect(resolveServerTarget(
      "http://localhost:4096/",
      { OPENCODE_PORT: "5317" },
      noopLog,
    )).toEqual({
      serverUrl: "http://localhost:5317",
      source: "explicit-port",
      trusted: true,
    })
  })

  it("rejects non-HTTP context protocols", () => {
    expect(resolveServerTarget("ftp://127.0.0.1:7443/private", {}, noopLog)).toEqual({
      serverUrl: "http://localhost:4096",
      source: "synthetic-fallback",
      trusted: false,
    })
  })

  for (const rawServerUrl of [undefined, "not a URL", "http://127.0.0.1:0/"]) {
    it(`uses a strict explicit port for ${rawServerUrl ?? "missing context"}`, () => {
      expect(resolveServerTarget(rawServerUrl, { OPENCODE_PORT: "5317" }, noopLog)).toEqual({
        serverUrl: "http://localhost:5317",
        source: "explicit-port",
        trusted: true,
      })
    })
  }

  for (const configuredPort of ["", "0", "-1", "+12", "12.5", " 12", "12 ", "01", "65536", "abc"]) {
    it(`rejects noncanonical OPENCODE_PORT ${JSON.stringify(configuredPort)}`, () => {
      expect(resolveServerTarget(undefined, { OPENCODE_PORT: configuredPort }, noopLog)).toEqual({
        serverUrl: "http://localhost:4096",
        source: "synthetic-fallback",
        trusted: false,
      })
    })
  }

  it("rejects URL userinfo without logging it or path/query secrets", () => {
    const logs: unknown[] = []
    const result = resolveServerTarget(
      "http://private-user:private-pass@localhost:5000/token/private-path?key=private-query",
      {},
      (_message, data) => logs.push(data),
    )

    expect(result.trusted).toBe(false)
    expect(JSON.stringify(logs)).not.toContain("private-user")
    expect(JSON.stringify(logs)).not.toContain("private-pass")
    expect(JSON.stringify(logs)).not.toContain("private-path")
    expect(JSON.stringify(logs)).not.toContain("private-query")
  })

  it("logs only the origin for port-zero URLs", () => {
    const logs: unknown[] = []
    resolveServerTarget(
      "http://127.0.0.1:0/private-path?token=private-query",
      {},
      (_message, data) => logs.push(data),
    )

    expect(logs).toContainEqual({
      kind: "warning",
      ctxServerOrigin: "http://127.0.0.1:0",
      fallbackUrl: "http://localhost:4096",
    })
    expect(JSON.stringify(logs)).not.toContain("private-path")
    expect(JSON.stringify(logs)).not.toContain("private-query")
  })

  it("keeps resolveServerUrl as a string compatibility wrapper", () => {
    expect(resolveServerUrl(undefined, {}, noopLog)).toBe("http://localhost:4096")
  })
})
