import { describe, expect, it } from "bun:test";

import {
	collectPostEditDiagnostics,
	createPostEditNotConfiguredCache,
	resetPostEditNotConfiguredCache,
} from "./orchestration.js";

describe("collectPostEditDiagnostics", () => {
	it("#given rendered not_configured text #when the same extension is checked again #then the text is not cached", async () => {
		const cache = createPostEditNotConfiguredCache();
		let calls = 0;

		const first = await collectPostEditDiagnostics({
			filePaths: ["a.foo"],
			cache,
			runDiagnostics: async () => {
				calls += 1;
				return "No LSP server configured for extension: .foo\n\nordinary text from a renderer";
			},
		});
		const second = await collectPostEditDiagnostics({
			filePaths: ["b.foo"],
			cache,
			runDiagnostics: async () => {
				calls += 1;
				return "diagnostic for b.foo";
			},
		});

		expect(calls).toBe(2);
		expect(first.blocks).toEqual([
			{ filePath: "a.foo", diagnostics: "No LSP server configured for extension: .foo\n\nordinary text from a renderer" },
		]);
		expect(second.blocks).toEqual([{ filePath: "b.foo", diagnostics: "diagnostic for b.foo" }]);
		expect([...cache.notConfiguredExtensions]).toEqual([]);
	});

	it("#given duplicate edited paths #when diagnostics run #then first seen paths are processed once and blocks stay ordered", async () => {
		const calls: string[] = [];

		const result = await collectPostEditDiagnostics({
			filePaths: ["a.ts", "b.ts", "a.ts", "c.ts"],
			runDiagnostics: async (filePath: string) => {
				calls.push(filePath);
				return filePath === "b.ts" ? "No diagnostics found" : `diagnostic for ${filePath}`;
			},
		});

		expect(calls).toEqual(["a.ts", "b.ts", "c.ts"]);
		expect(result.blocks).toEqual([
			{ filePath: "a.ts", diagnostics: "diagnostic for a.ts" },
			{ filePath: "c.ts", diagnostics: "diagnostic for c.ts" },
		]);
	});

	it("#given many edited paths #when diagnostics run #then concurrency is bounded to four and failures isolate", async () => {
		let active = 0;
		let maxActive = 0;

		const result = await collectPostEditDiagnostics({
			filePaths: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
			runDiagnostics: async (filePath: string) => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await Promise.resolve();
				active -= 1;
				if (filePath === "c.ts") throw new Error("server exploded");
				return filePath === "e.ts" ? "No diagnostics found" : `diagnostic for ${filePath}`;
			},
		});

		expect(maxActive).toBe(4);
		expect(result.blocks).toEqual([
			{ filePath: "a.ts", diagnostics: "diagnostic for a.ts" },
			{ filePath: "b.ts", diagnostics: "diagnostic for b.ts" },
			{ filePath: "c.ts", diagnostics: "server exploded" },
			{ filePath: "d.ts", diagnostics: "diagnostic for d.ts" },
			{ filePath: "f.ts", diagnostics: "diagnostic for f.ts" },
		]);
	});

	it("#given structured not_configured diagnostics #when cache is reused and reset #then only not_configured is cached", async () => {
		const cache = createPostEditNotConfiguredCache();
		const calls: string[] = [];
		const responses = new Map<string, string | { readonly kind: "not_configured"; readonly extension: string }>([
			["a.foo", { kind: "not_configured", extension: ".foo" }],
			["b.foo", "diagnostic should be skipped"],
			["c.bar", "LSP server 'bar' for .bar is NOT INSTALLED."],
		]);

		const first = await collectPostEditDiagnostics({
			filePaths: ["a.foo", "c.bar"],
			cache,
			runDiagnostics: async (filePath: string) => {
				calls.push(filePath);
				return responses.get(filePath) ?? "No diagnostics found";
			},
		});

		expect(calls).toEqual(["a.foo", "c.bar"]);
		expect(first.blocks).toEqual([{ filePath: "c.bar", diagnostics: "LSP server 'bar' for .bar is NOT INSTALLED." }]);

		const cached = await collectPostEditDiagnostics({
			filePaths: ["b.foo"],
			cache,
			runDiagnostics: async (filePath: string) => {
				calls.push(filePath);
				return responses.get(filePath) ?? "No diagnostics found";
			},
		});

		expect(cached.blocks).toEqual([]);
		expect(calls).toEqual(["a.foo", "c.bar"]);

		responses.set("a.foo", "No diagnostics found");
		resetPostEditNotConfiguredCache(cache);
		const second = await collectPostEditDiagnostics({
			filePaths: ["a.foo", "b.foo"],
			cache,
			runDiagnostics: async (filePath: string) => {
				calls.push(filePath);
				return responses.get(filePath) ?? "No diagnostics found";
			},
		});

		expect(second.blocks).toEqual([{ filePath: "b.foo", diagnostics: "diagnostic should be skipped" }]);
		expect(calls).toEqual(["a.foo", "c.bar", "a.foo", "b.foo"]);
	});

	it("#given non-not_configured failures #when cache is reused #then every failure retries", async () => {
		const cache = createPostEditNotConfiguredCache();
		let calls = 0;

		const first = await collectPostEditDiagnostics({
			filePaths: ["a.foo"],
			cache,
			runDiagnostics: async () => {
				calls += 1;
				return "LSP server 'foo' for .foo is NOT INSTALLED.";
			},
		});
		const second = await collectPostEditDiagnostics({
			filePaths: ["b.foo"],
			cache,
			runDiagnostics: async () => {
				calls += 1;
				throw new Error("daemon unavailable");
			},
		});

		expect(calls).toBe(2);
		expect(first.blocks).toEqual([{ filePath: "a.foo", diagnostics: "LSP server 'foo' for .foo is NOT INSTALLED." }]);
		expect(second.blocks).toEqual([{ filePath: "b.foo", diagnostics: "daemon unavailable" }]);
		expect([...cache.notConfiguredExtensions]).toEqual([]);
	});
});
