import { describe, expect, test } from "bun:test"
import {
  loadDeepSeekProviders,
  resetProviderCacheForTests,
  resolveProviderIds,
  selectDeepSeekProvider,
  type ProviderStoreLike,
} from "./provider-factory"
import type { ProviderCredentials } from "../providers/provider-types"

function makeStore(map: Record<string, ProviderCredentials>): ProviderStoreLike {
  return { getProvider: (id) => map[id] ?? null }
}

function makeCreds(
  id: string,
  provider_type = "deepseek_web",
  base_url = "https://chat.deepseek.com",
): ProviderCredentials {
  return {
    id,
    name: id,
    provider_type,
    base_url,
    auth_type: "cookie_session",
    auth_config: JSON.stringify({ aws_waf_token: "stub", auto_solve_pow: true }),
    default_headers: null,
    rate_limit_rps: null,
    rate_limit_rpm: null,
    rate_limit_tpm: null,
    cooldown_on_429_s: 0,
    supported_models: null,
    health_check_url: null,
    health_check_interval_s: 0,
    status: "active",
    created_at: 0,
    updated_at: 0,
  }
}

describe("selectDeepSeekProvider", () => {
  describe("#given a registered deepseek_web provider", () => {
    test("#when selected #then returns provider + baseUrl + creds", () => {
      const store = makeStore({ "ds-1": makeCreds("ds-1") })
      const r = selectDeepSeekProvider(store, "ds-1")
      expect(r.baseUrl).toBe("https://chat.deepseek.com")
      expect(r.provider.id).toBe("ds-1")
      expect(r.provider.kind).toBe("deepseek_web")
      expect(r.creds.id).toBe("ds-1")
      expect(r.creds.provider_type).toBe("deepseek_web")
    })
  })

  describe("#given no provider with the requested id", () => {
    test("#when selected #then throws with not-found message", () => {
      const store = makeStore({})
      expect(() => selectDeepSeekProvider(store, "nope")).toThrow(/not found/)
    })
  })

  describe("#given a non-deepseek provider type", () => {
    test("#when selected #then throws with type-mismatch message", () => {
      const store = makeStore({ x: makeCreds("x", "openai_official") })
      expect(() => selectDeepSeekProvider(store, "x")).toThrow(/deepseek_web/)
    })
  })
})

describe("resolveProviderIds", () => {
  describe("#given explicit providerIds list #when resolved #then list returned verbatim", () => {
    test("explicit list", () => {
      expect(resolveProviderIds({ providerIds: ["a", "b"] })).toEqual(["a", "b"])
    })
  })

  describe("#given IDM_OPENAI_COMPAT_PROVIDER_IDS env #when resolved #then comma-split + trimmed", () => {
    test("env-multi", () => {
      const prev = process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
      process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS = "x, y , z"
      try {
        expect(resolveProviderIds()).toEqual(["x", "y", "z"])
      } finally {
        if (prev === undefined) delete process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
        else process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS = prev
      }
    })
  })

  describe("#given only single env #when resolved #then list with one entry", () => {
    test("env-single fallback", () => {
      const prevMulti = process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
      const prevSingle = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      delete process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
      process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = "solo-x"
      try {
        expect(resolveProviderIds()).toEqual(["solo-x"])
      } finally {
        if (prevMulti === undefined)
          delete process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
        else process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS = prevMulti
        if (prevSingle === undefined)
          delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
        else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = prevSingle
      }
    })
  })
})

describe("loadDeepSeekProviders", () => {
  describe("#given a store with two deepseek_web providers #when loaded with explicit ids #then both returned in order", () => {
    test("multi-load", () => {
      resetProviderCacheForTests()
      const store = makeStore({
        "p-1": makeCreds("p-1"),
        "p-2": makeCreds("p-2"),
      })
      const out = loadDeepSeekProviders({
        providerIds: ["p-1", "p-2"],
        store,
      })
      expect(out).toHaveLength(2)
      expect(out[0]!.creds.id).toBe("p-1")
      expect(out[1]!.creds.id).toBe("p-2")
      resetProviderCacheForTests()
    })
  })

  describe("#given duplicate ids #when loaded #then deduped", () => {
    test("dedupe", () => {
      resetProviderCacheForTests()
      const store = makeStore({ "p-1": makeCreds("p-1") })
      const out = loadDeepSeekProviders({
        providerIds: ["p-1", "p-1"],
        store,
      })
      expect(out).toHaveLength(1)
      resetProviderCacheForTests()
    })
  })

  describe("#given an unknown id mid-list #when loaded #then throws on first miss", () => {
    test("missing rejects", () => {
      resetProviderCacheForTests()
      const store = makeStore({ "p-1": makeCreds("p-1") })
      expect(() =>
        loadDeepSeekProviders({
          providerIds: ["p-1", "missing"],
          store,
        }),
      ).toThrow(/not found/)
      resetProviderCacheForTests()
    })
  })

  describe("#given only IDM_OPENAI_COMPAT_PROVIDER_ID env (singular legacy) #when loaded #then yields exactly one LoadedProvider (pool-of-1 path)", () => {
    test("singular env -> pool of 1", () => {
      resetProviderCacheForTests()
      const prevMulti = process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
      const prevSingle = process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
      delete process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
      process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = "legacy-solo"
      try {
        const ids = resolveProviderIds()
        expect(ids).toEqual(["legacy-solo"])
        const store = makeStore({ "legacy-solo": makeCreds("legacy-solo") })
        const out = loadDeepSeekProviders({ store })
        expect(out).toHaveLength(1)
        expect(out[0]!.creds.id).toBe("legacy-solo")
      } finally {
        if (prevMulti === undefined)
          delete process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS
        else process.env.IDM_OPENAI_COMPAT_PROVIDER_IDS = prevMulti
        if (prevSingle === undefined)
          delete process.env.IDM_OPENAI_COMPAT_PROVIDER_ID
        else process.env.IDM_OPENAI_COMPAT_PROVIDER_ID = prevSingle
        resetProviderCacheForTests()
      }
    })
  })
})
