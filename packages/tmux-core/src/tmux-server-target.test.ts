import { describe, expect, it } from "bun:test"

import { getHttpServerOriginForLog } from "./tmux-server-target"

describe("getHttpServerOriginForLog", () => {
	it("returns only the HTTP(S) origin and drops every secret-bearing URL component", () => {
		expect(getHttpServerOriginForLog("https://user:password@127.0.0.1:43127/private?token=query-secret#fragment-secret"))
			.toBe("https://127.0.0.1:43127")
	})

	it("returns undefined for missing, malformed, and unsupported URLs without echoing the input", () => {
		expect(getHttpServerOriginForLog(undefined)).toBeUndefined()
		expect(getHttpServerOriginForLog("malformed-url-secret")).toBeUndefined()
		expect(getHttpServerOriginForLog("file:///tmp/private-token")).toBeUndefined()
	})
})
