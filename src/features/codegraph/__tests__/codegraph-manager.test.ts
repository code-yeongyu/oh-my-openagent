import { describe, it, expect } from "bun:test"
import { CodeGraphManager } from "../codegraph-manager"
function cfg(o: Record<string, unknown> = {}) {
  return { enabled: true, auto_init: false, init_timeout_ms: 5000, fallback_on_error: true, fallback_on_empty: true, prefer_codegraph: true, ...o } as any
}
describe("CodeGraphManager", () => {
  it("default isAvailable false", () => { const m = new CodeGraphManager({ directory: "/tmp", config: cfg() }); expect(m).toBeDefined(); expect(m.isAvailable()).toBe(false) })
  it("getStatus shape", () => { const s = new CodeGraphManager({ directory: "/tmp", config: cfg() }).getStatus(); expect(s).toHaveProperty("isAvailable"); expect(s.isAvailable).toBe(false) })
  it("checkHealth false uninit", async () => { expect(await new CodeGraphManager({ directory: "/tmp", config: cfg() }).checkHealth()).toBe(false) })
  it("ensureIndex false auto_init off", async () => { expect(await new CodeGraphManager({ directory: "/tmp", config: cfg({ auto_init: false }) }).ensureIndex()).toBe(false) })
  it("initialize false disabled", async () => { expect(await new CodeGraphManager({ directory: "/tmp", config: cfg({ enabled: false }) }).initialize()).toBe(false) })
  it("shouldPreferCodeGraph false unavail", () => { expect(new CodeGraphManager({ directory: "/tmp", config: cfg() }).shouldPreferCodeGraph()).toBe(false) })
  it("getIndexPath null uninit", () => { expect(new CodeGraphManager({ directory: "/tmp", config: cfg() }).getIndexPath()).toBeNull() })
})
