import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { callToolViaDaemon } from "../src/client.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
	readonly main?: string;
	readonly types?: string;
	readonly exports?: Record<string, unknown>;
};
const clientSource = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");

describe("public client package surface", () => {
	it("#given the lsp-daemon package manifest #when consumers resolve package subpaths #then only client and cli are exported", () => {
		expect(packageJson.main).toBeUndefined();
		expect(packageJson.types).toBeUndefined();
		expect(Object.keys(packageJson.exports ?? {}).sort()).toEqual(["./cli", "./client"]);
		expect(packageJson.exports?.["."]).toBeUndefined();
		expect(packageJson.exports?.["./dist/cli.js"]).toBeUndefined();
	});

	it("#given the client source #when reviewing public exports #then server proxy ownership and lock internals stay private", () => {
		expect(clientSource).toContain("callToolViaDaemon");
		expect(clientSource).toContain("callDiagnosticsViaDaemon");
		expect(clientSource).toContain("OMO_LSP_DAEMON_CLI");
		expect(clientSource).not.toContain("runMcpStdioProxy");
		expect(clientSource).not.toContain("startDaemonServer");
		expect(clientSource).not.toContain("ensureDaemonRunning");
		expect(clientSource).not.toContain("daemonPaths");
		expect(clientSource).not.toContain("disposeDefaultLspManager");
	});

	it("#given the public client type surface #when reviewing call options #then daemon context is mandatory", () => {
		expect(clientSource).toContain("readonly context: DaemonToolContext");
		expect(clientSource).not.toContain("readonly context?: DaemonToolContext");
	});

	it("#given omitted context #when calling the public client #then rejection happens before daemon dispatch", async () => {
		const ensure = vi.fn(async () => {});
		const paths = daemonTestPaths(fileURLToPath(new URL("client-surface-daemon", import.meta.url)));

		await expect(Reflect.apply(callToolViaDaemon, undefined, ["status", {}, { paths, ensure }])).rejects.toThrow(
			/context/i,
		);
		expect(ensure).not.toHaveBeenCalled();
	});

	it.each([
		{ name: "empty object", context: {} },
		{ name: "null", context: null },
		{ name: "array", context: [] },
		{ name: "scalar", context: "not-a-context" },
		{ name: "unknown field", context: { cwd: process.cwd(), env: {} } },
	])(
		"#given malformed public client context $name #when calling the public client #then rejection happens before daemon dispatch",
		async ({ name, context }) => {
			const ensure = vi.fn(async () => {});
			const paths = daemonTestPaths(fileURLToPath(new URL(`client-surface-malformed-${name}`, import.meta.url)));

			await expect(
				Reflect.apply(callToolViaDaemon, undefined, ["status", {}, { paths, ensure, context }]),
			).rejects.toThrow(/context|field|capabilities/i);
			expect(ensure).not.toHaveBeenCalled();
		},
	);
});
