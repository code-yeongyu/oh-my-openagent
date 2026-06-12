import { describe, expect, it } from "vitest";

import { effectiveExtension } from "../src/lsp/effective-extension.js";
import { findServerForExtension } from "../src/lsp/server-resolution.js";

describe("effectiveExtension", () => {
	it("#given a file literally named Dockerfile #when resolving its extension #then maps to .dockerfile", () => {
		// given / when
		const ext = effectiveExtension("/project/Dockerfile");

		// then
		expect(ext).toBe(".dockerfile");
	});

	it("#given a Containerfile #when resolving its extension #then maps to .dockerfile", () => {
		// given / when / then
		expect(effectiveExtension("/project/Containerfile")).toBe(".dockerfile");
	});

	it("#given a nested Dockerfile #when resolving its extension #then still maps to .dockerfile", () => {
		// given / when / then
		expect(effectiveExtension("/repo/services/api/Dockerfile")).toBe(".dockerfile");
	});

	it("#given a normal source file #when resolving its extension #then returns the real extname", () => {
		// given / when / then
		expect(effectiveExtension("/project/src/app.ts")).toBe(".ts");
	});

	it("#given a file already carrying the .dockerfile extension #when resolving #then returns .dockerfile", () => {
		// given / when / then
		expect(effectiveExtension("/project/build.dockerfile")).toBe(".dockerfile");
	});

	it("#given an extensionless non-docker file #when resolving #then returns an empty extname", () => {
		// given / when / then
		expect(effectiveExtension("/project/README")).toBe("");
	});

	it("#given a Dockerfile basename #when resolving the server #then the dockerfile server is selected", () => {
		// given / when
		const result = findServerForExtension(effectiveExtension("/project/Dockerfile"));

		// then
		expect(result.status).not.toBe("not_configured");
		if (result.status !== "not_configured") {
			expect(result.server.id).toBe("dockerfile");
		}
	});
});
