/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createIdentityPool } from "../../features/probe-lab/identity-pool"
import { createProbeStore } from "../../features/probe-lab/sqlite-store"
import { createProviderRegistry } from "../../features/probe-lab/providers/provider-registry"
import { createProbeProviderRegisterTool } from "./probe-provider-register-tool"
import { createProbeHypothesisSupersedeTool, __setSupersedeKbClientForTest } from "./probe-hypothesis-supersede-tool"
import { createProbeCanaryLockTool } from "./probe-canary-lock-tool"

let tmpDir: string

const stubKb = {
  argue: async () => ({}),
  kbAdd: async (input: { layer: string; content: unknown; tags: ReadonlyArray<string> }) => ({ id: `kb-stub-${Math.random().toString(36).slice(2, 8)}`, layer: input.layer, content: input.content, tags: input.tags }),
  kbQuery: async () => [],
  kbRemove: async () => ({ removed: 0 }),
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-rbac-"))
  __setSupersedeKbClientForTest(stubKb as never)
})

afterEach(() => {
  __setSupersedeKbClientForTest(null)
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeCtx() {
  const store = createProbeStore(join(tmpDir, "lab.db"))
  const pool = createIdentityPool({ store })
  const providerRegistry = createProviderRegistry({ store })
  return { store, pool, providerRegistry }
}

describe("probe-lab v1.0 RBAC gate", () => {
  test("probe_provider_register #given role=viewer #when called #then denied with RBAC error", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("current_role", "viewer", "test override")
    const resp = await createProbeProviderRegisterTool(ctx).execute({
      name: "x", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "bearer_token", auth_config: { bearer_token: "x" },
    }, { sessionID: "t" } as never)
    expect(resp as string).toContain("RBAC")
    expect(resp as string).toContain("viewer")
    ctx.store.close()
  })

  test("probe_provider_register #given role=operator #when called #then denied (admin-tier tool)", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("current_role", "operator", "test override")
    const resp = await createProbeProviderRegisterTool(ctx).execute({
      name: "x", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "bearer_token", auth_config: { bearer_token: "x" },
    }, { sessionID: "t" } as never)
    expect(resp as string).toContain("RBAC")
    ctx.store.close()
  })

  test("probe_provider_register #given role=admin #when called #then succeeds", async () => {
    const ctx = makeCtx()
    ctx.store.setProbeLabConfig("current_role", "admin", "test override")
    const resp = await createProbeProviderRegisterTool(ctx).execute({
      name: "x", provider_type: "ds2api", base_url: "http://localhost:1", auth_type: "bearer_token", auth_config: { bearer_token: "x" },
    }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { status: string }
    expect(parsed.status).toBe("active")
    ctx.store.close()
  })

  test("probe_hypothesis_supersede #given role=operator #when called #then denied (admin-tier)", async () => {
    const ctx = makeCtx()
    ctx.store.insertHypothesis({ id: "h-old", text: "x", falsifiability_criteria: "c" })
    ctx.store.insertHypothesis({ id: "h-new", text: "y", falsifiability_criteria: "c" })
    ctx.store.setProbeLabConfig("current_role", "operator", "downgrade")
    const resp = await createProbeHypothesisSupersedeTool(ctx).execute({ hypothesis_id: "h-old", superseded_by: "h-new", reason: "test" }, { sessionID: "t" } as never)
    expect(resp as string).toContain("RBAC")
    ctx.store.close()
  })

  test("probe_canary_lock #given role=operator #when called #then succeeds (operator-tier tool)", async () => {
    const ctx = makeCtx()
    ctx.store.upsertIdentity({ id: "id-c", kind: "api_key", config: {}, status: "active" })
    ctx.store.setProbeLabConfig("current_role", "operator", "downgrade")
    const resp = await createProbeCanaryLockTool(ctx).execute({ identity_id: "id-c", action: "lock", lock_reason: "test" }, { sessionID: "t" } as never)
    const parsed = JSON.parse(resp as string) as { new_status: string }
    expect(parsed.new_status).toBe("locked")
    ctx.store.close()
  })

  test("probe_canary_lock #given role=viewer #when called #then denied", async () => {
    const ctx = makeCtx()
    ctx.store.upsertIdentity({ id: "id-c2", kind: "api_key", config: {}, status: "active" })
    ctx.store.setProbeLabConfig("current_role", "viewer", "downgrade")
    const resp = await createProbeCanaryLockTool(ctx).execute({ identity_id: "id-c2", action: "lock", lock_reason: "test" }, { sessionID: "t" } as never)
    expect(resp as string).toContain("RBAC")
    ctx.store.close()
  })
})
