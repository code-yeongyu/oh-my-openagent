import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { hasXaiCredential, resolveXaiBearer, type XaiAuthRegistry } from "./auth"

const registry = (stored: unknown, result: unknown = { auth: { apiKey: "stored-token" } }): XaiAuthRegistry => ({
  authStorage: { get: () => stored },
  getProviderAuth: async () => result as never,
})
const dir = (value: unknown) => { const d = mkdtempSync(join(tmpdir(), "x-auth-")); writeFileSync(join(d, "auth.json"), JSON.stringify(value)); return d }

describe("xAI auth", () => {
  test("stored credential uses registry bearer", async () => expect(await resolveXaiBearer({ modelRegistry: registry({ type: "oauth" }), env: { XAI_API_KEY: "env" } })).toEqual({ bearer: "stored-token", provenance: "store" }))
  test("stored credential failure fails closed", async () => expect(await resolveXaiBearer({ modelRegistry: { ...registry({ type: "oauth" }), getProviderAuth: async () => { throw new Error("refresh") } }, env: { XAI_API_KEY: "env" } })).toBeUndefined())
  test("no stored credential uses trimmed env", async () => expect(await resolveXaiBearer({ modelRegistry: registry(undefined), env: { XAI_API_KEY: "  env-token " } })).toEqual({ bearer: "env-token", provenance: "env" }))
  test("neither source is undefined", async () => expect(await resolveXaiBearer({ modelRegistry: registry(undefined), env: {} })).toBeUndefined())
  test("credential gate recognizes oauth and api_key", () => { expect(hasXaiCredential({ agentDir: dir({ xai: { type: "oauth" } }), env: {} })).toBe(true); expect(hasXaiCredential({ agentDir: dir({ xai: { type: "api_key" } }), env: {} })).toBe(true) })
  test("gate handles missing, invalid, and unknown entries", () => { expect(hasXaiCredential({ agentDir: "/missing", env: {} })).toBe(false); const d = mkdtempSync(join(tmpdir(), "x-auth-")); writeFileSync(join(d, "auth.json"), "{"); expect(hasXaiCredential({ agentDir: d, env: { XAI_API_KEY: "env" } })).toBe(false); expect(hasXaiCredential({ agentDir: dir({ xai: { type: "other" } }), env: { XAI_API_KEY: "env" } })).toBe(false) })
  test("env gates missing file", () => expect(hasXaiCredential({ agentDir: "/missing", env: { XAI_API_KEY: " env " } })).toBe(true))
})
