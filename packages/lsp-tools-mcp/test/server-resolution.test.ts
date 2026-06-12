import { describe, expect, it } from "vitest";

import { findServerForExtension } from "../src/lsp/server-resolution.js";

describe("findServerForExtension", () => {
	it("#given an Objective-C .m extension #when resolving the server #then sourcekit-lsp is selected", () => {
		// given / when
		const result = findServerForExtension(".m");

		// then
		expect(result.status).not.toBe("not_configured");
		if (result.status !== "not_configured") {
			expect(result.server.id).toBe("sourcekit-lsp");
		}
	});

	it("#given an Objective-C++ .mm extension #when resolving the server #then sourcekit-lsp is selected", () => {
		// given / when
		const result = findServerForExtension(".mm");

		// then
		expect(result.status).not.toBe("not_configured");
		if (result.status !== "not_configured") {
			expect(result.server.id).toBe("sourcekit-lsp");
		}
	});

	it("#given the bogus .objc extension #when resolving the server #then no server is configured", () => {
		// given / when
		const result = findServerForExtension(".objc");

		// then
		expect(result.status).toBe("not_configured");
	});
});
