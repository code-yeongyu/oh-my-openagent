import { describe, expect, test } from "bun:test";

import { findServerForExtension } from "./server-resolution.js";

describe("findServerForExtension", () => {
	test("#given uppercase extension #when resolving server #then matches lowercase registry entry", () => {
		// given / when
		const result = findServerForExtension(".TS");

		// then
		expect(result.status).not.toBe("not_configured");
		if (result.status === "found" || result.status === "not_installed") {
			expect(result.server.id).toBe("typescript");
		}
	});
});
