import { describe, expect, test } from "bun:test"
import { validateGatewayUrl } from "./gateway-url-validation"

describe("validateGatewayUrl", () => {
  test("allows https and local http while rejecting remote or invalid urls", () => {
    // given representative gateway urls
    const httpsRemote = "https://example.com"
    const httpRemote = "http://example.com"
    const httpLocalhost = "http://localhost:3000"
    const httpLoopback = "http://127.0.0.1:3000"
    const httpIpv6Loopback = "http://[::1]:3000"
    const invalidUrl = "not-a-url"

    // when validating each url
    const results = {
      httpsRemote: validateGatewayUrl(httpsRemote),
      httpRemote: validateGatewayUrl(httpRemote),
      httpLocalhost: validateGatewayUrl(httpLocalhost),
      httpLoopback: validateGatewayUrl(httpLoopback),
      httpIpv6Loopback: validateGatewayUrl(httpIpv6Loopback),
      invalidUrl: validateGatewayUrl(invalidUrl),
    }

    // then only https and localhost loopback urls are allowed
    expect(results).toEqual({
      httpsRemote: true,
      httpRemote: false,
      httpLocalhost: true,
      httpLoopback: true,
      httpIpv6Loopback: true,
      invalidUrl: false,
    })
  })
})
