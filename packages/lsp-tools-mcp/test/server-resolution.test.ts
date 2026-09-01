import { describe, expect, it } from "vitest";

import { findServerForExtension } from "../src/lsp/server-resolution.js";
import { createStandaloneMcpRequestContext, runWithRequestContext } from "../src/request-context.js";

function findServer(extension: string) {
	return runWithRequestContext(createStandaloneMcpRequestContext(), () => findServerForExtension(extension));
}

describe("findServerForExtension", () => {
	it("#given an Objective-C .m extension #when resolving the server #then sourcekit-lsp is selected", () => {
		// given / when
		const result = findServer(".m");

		// then
		expect(result.status).not.toBe("not_configured");
		if (result.status !== "not_configured") {
			expect(result.server.id).toBe("sourcekit-lsp");
		}
	});

	it("#given an Objective-C++ .mm extension #when resolving the server #then sourcekit-lsp is selected", () => {
		// given / when
		const result = findServer(".mm");

		// then
		expect(result.status).not.toBe("not_configured");
		if (result.status !== "not_configured") {
			expect(result.server.id).toBe("sourcekit-lsp");
		}
	});

	it("#given the bogus .objc extension #when resolving the server #then no server is configured", () => {
		// given / when
		const result = findServer(".objc");

		// then
		expect(result.status).toBe("not_configured");
	});
});
