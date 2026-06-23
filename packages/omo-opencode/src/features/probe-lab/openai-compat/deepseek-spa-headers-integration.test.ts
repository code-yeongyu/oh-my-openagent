import { describe, expect, test } from "bun:test"
import {
  buildDeepSeekSpaHeaders,
  DEEPSEEK_SPA_BASE_HEADERS,
  parseDeepSeekAuthConfig,
} from "./deepseek-spa-headers"
import type { ProviderCredentials } from "../providers/provider-types"

function baseCreds(
  overrides: Partial<ProviderCredentials> = {},
): ProviderCredentials {
  return {
    id: "ds-test",
    provider_type: "deepseek_web",
    name: "ds-test",
    base_url: "https://chat.deepseek.com",
    auth_type: "cookie_session",
    auth_config: JSON.stringify({
      aws_waf_token: "waf-abc",
      session_cookie: "ds_session_id=test-session",
      bearer_token: "test-bearer",
    }),
    default_headers: null,
    ...overrides,
  }
}

describe("buildDeepSeekSpaHeaders", () => {
  describe("#given standard credentials", () => {
    test("#when called with no extras #then returns all 4 SPA identity headers", () => {
      const { headers } = buildDeepSeekSpaHeaders(baseCreds(), {})
      expect(headers["x-client-platform"]).toBe("web")
      expect(headers["x-client-version"]).toBe("2.0.0")
      expect(headers["x-client-locale"]).toBe("en_US")
      expect(headers["x-client-timezone-offset"]).toBe("0")
    })

    test("#when called with no extras #then builds cookie from auth_config", () => {
      const { headers } = buildDeepSeekSpaHeaders(baseCreds(), {})
      expect(headers.Cookie).toContain("aws-waf-token=waf-abc")
      expect(headers.Cookie).toContain("ds_session_id=test-session")
    })

    test("#when called with no extras #then does NOT set Authorization (no explicit authorization field)", () => {
      const creds = baseCreds({
        auth_config: JSON.stringify({
          aws_waf_token: "waf-abc",
          session_cookie: "test",
        }),
      })
      const { headers } = buildDeepSeekSpaHeaders(creds, {})
      expect(headers.Authorization).toBeUndefined()
    })

    test("#when called with no extras #then sets Authorization when bearer_token present", () => {
      const { headers } = buildDeepSeekSpaHeaders(baseCreds(), {})
      expect(headers.Authorization).toBe("Bearer test-bearer")
    })
  })

  describe("#given credentials with authorization field", () => {
    test("#when authorization is explicit #then used directly", () => {
      const creds = baseCreds({
        auth_config: JSON.stringify({
          aws_waf_token: "waf-abc",
          authorization: "Token direct-token",
          bearer_token: "should-not-win",
        }),
      })
      const { headers } = buildDeepSeekSpaHeaders(creds, {})
      expect(headers.Authorization).toBe("Token direct-token")
    })
  })

  describe("#given credentials with default_headers containing overrides", () => {
    test("#when default_headers has Origin #then Origin appears in output", () => {
      const creds = baseCreds({
        default_headers: JSON.stringify({
          Origin: "https://chat.deepseek.com",
        }),
      })
      const { headers } = buildDeepSeekSpaHeaders(creds, {})
      expect(headers.Origin).toBe("https://chat.deepseek.com")
    })

    test("#when default_headers has x-app-version #then x-app-version appears in output", () => {
      const creds = baseCreds({
        default_headers: JSON.stringify({
          "x-app-version": "20241129.1",
        }),
      })
      const { headers } = buildDeepSeekSpaHeaders(creds, {})
      expect(headers["x-app-version"]).toBe("20241129.1")
    })

    test("#when default_headers has a conflicting SPA header #then provider override wins", () => {
      const creds = baseCreds({
        default_headers: JSON.stringify({
          "x-client-platform": "overridden-platform",
        }),
      })
      const { headers } = buildDeepSeekSpaHeaders(creds, {})
      expect(headers["x-client-platform"]).toBe("overridden-platform")
    })
  })

  describe("#given default_headers contains proxy marker", () => {
    test("#when __proxy_url__ present #then returns proxyUrl and strips it from headers", () => {
      const creds = baseCreds({
        default_headers: JSON.stringify({
          Origin: "https://chat.deepseek.com",
          __proxy_url__: "http://proxy:8080",
        }),
      })
      const { headers, proxyUrl } = buildDeepSeekSpaHeaders(creds, {})
      expect(proxyUrl).toBe("http://proxy:8080")
      expect(headers.Origin).toBe("https://chat.deepseek.com")
      expect(headers.__proxy_url__).toBeUndefined()
    })
  })

  describe("#given caller extras", () => {
    test("#when extras contains Content-Type #then appears in output", () => {
      const { headers } = buildDeepSeekSpaHeaders(baseCreds(), {
        "Content-Type": "application/json",
      })
      expect(headers["Content-Type"]).toBe("application/json")
    })

    test("#when extras contains Accept (streaming path) #then appears in output", () => {
      const { headers } = buildDeepSeekSpaHeaders(baseCreds(), {
        "Content-Type": "application/json",
        Accept: "application/json",
      })
      expect(headers.Accept).toBe("application/json")
    })
  })
})

describe("streaming vs non-streaming header parity", () => {
  const creds = baseCreds()

  test("#when building non-stream headers (provider path) #then contains all required headers", () => {
    const { headers } = buildDeepSeekSpaHeaders(creds, {
      "Content-Type": "application/json",
    })
    expect(headers["x-client-platform"]).toBe("web")
    expect(headers["x-client-version"]).toBe("2.0.0")
    expect(headers["x-client-locale"]).toBe("en_US")
    expect(headers.Cookie).toContain("aws-waf-token")
    expect(headers.Authorization).toBe("Bearer test-bearer")
  })

  test("#when building stream headers (streaming path) #then contains all required headers + Accept", () => {
    const { headers } = buildDeepSeekSpaHeaders(creds, {
      "Content-Type": "application/json",
      Accept: "application/json",
    })
    expect(headers["x-client-platform"]).toBe("web")
    expect(headers["x-client-version"]).toBe("2.0.0")
    expect(headers["x-client-locale"]).toBe("en_US")
    expect(headers.Accept).toBe("application/json")
    expect(headers.Cookie).toContain("aws-waf-token")
    expect(headers.Authorization).toBe("Bearer test-bearer")
  })

  test("#when both paths use same creds #then SPA identity headers are identical", () => {
    const nonStream = buildDeepSeekSpaHeaders(creds, {
      "Content-Type": "application/json",
    })
    const stream = buildDeepSeekSpaHeaders(creds, {
      "Content-Type": "application/json",
      Accept: "application/json",
    })
    expect(nonStream.headers["x-client-platform"]).toBe(
      stream.headers["x-client-platform"],
    )
    expect(nonStream.headers["x-client-version"]).toBe(
      stream.headers["x-client-version"],
    )
    expect(nonStream.headers["x-client-locale"]).toBe(
      stream.headers["x-client-locale"],
    )
    expect(nonStream.headers.Cookie).toBe(stream.headers.Cookie)
    expect(nonStream.headers.Authorization).toBe(
      stream.headers.Authorization,
    )
  })
})

describe("DEEPSEEK_SPA_BASE_HEADERS snapshot", () => {
  test("#when read #then matches current web bundle (app version 2.0.0, commit 1300ef9f7)", () => {
    expect(DEEPSEEK_SPA_BASE_HEADERS).toEqual({
      "x-app-version": "2.0.0",
      "x-client-platform": "web",
      "x-client-version": "2.0.0",
      "x-client-locale": "en_US",
      "x-client-timezone-offset": "0",
    })
  })
})

describe("parseDeepSeekAuthConfig", () => {
  test("#when auth_config has bearer_token #then authorization is Bearer-prefixed", () => {
    const auth = parseDeepSeekAuthConfig(
      JSON.stringify({ bearer_token: "abc123" }),
    )
    expect(auth.authorization).toBe("Bearer abc123")
  })

  test("#when auth_config has cookie field #then session_cookie reads from cookie", () => {
    const auth = parseDeepSeekAuthConfig(
      JSON.stringify({ cookie: "sess=old" }),
    )
    expect(auth.session_cookie).toBe("sess=old")
  })

  test("#when auth_config has session_cookie #then it takes precedence", () => {
    const auth = parseDeepSeekAuthConfig(
      JSON.stringify({ session_cookie: "sess=new", cookie: "sess=old" }),
    )
    expect(auth.session_cookie).toBe("sess=new")
  })
})
