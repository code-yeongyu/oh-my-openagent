import { describe, expect, test } from "bun:test";

import { reportBestEffortCleanupError } from "./cleanup-errors.js";

describe("reportBestEffortCleanupError", () => {
	test("#given an injected cleanup logger #when cleanup fails #then the normal diagnostic is emitted without an environment gate", () => {
		// given
		const messages: string[] = [];

		// when
		reportBestEffortCleanupError("client stop", new Error("connection closed"), (message) => {
			messages.push(message);
		});

		// then
		expect(messages).toEqual(["[lsp] ignored client stop failure during cleanup: connection closed"]);
	});
});
