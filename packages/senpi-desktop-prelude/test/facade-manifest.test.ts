import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CHAIN_BINDINGS,
	COMPOSED_HELPERS,
	MANIFEST_COPY_PATH,
	type ManifestMethod,
	readManifestCopy,
	renderGeneratedSources,
	resolveTiers,
} from "../scripts/generate-assets";
import { computerPreludeAssets } from "../src/index";
import { ELEMENT_SNAPSHOT, loadJsFacade, runPythonFacade, type ToolResult, WINDOW_SNAPSHOT, windowResponder } from "./harness";

const SDK_MANIFEST = new URL("../../senpi-desktop-sdk/facade-manifest.json", import.meta.url);

describe("facade manifest copy", () => {
	it("is byte-identical to the SDK's facade-manifest.json", () => {
		expect(readFileSync(MANIFEST_COPY_PATH, "utf8")).toBe(readFileSync(SDK_MANIFEST, "utf8"));
	});

	it("keeps every generated source equal to what the generator renders", () => {
		// When
		const drifted = [...renderGeneratedSources()].filter(([path, content]) => readFileSync(path, "utf8") !== content);

		// Then
		expect(drifted.map(([path]) => path)).toEqual([]);
	});

	it("refuses a manifest method that no kernel helper binds or omits", () => {
		// Given
		const manifest: ManifestMethod[] = [...readManifestCopy(), { method: "Window.minimize", tier: "exec", wire: [] }];

		// When / Then
		expect(() => resolveTiers(manifest)).toThrow("Window.minimize has no kernel helper");
	});

	it("takes each sourced chain method's tier from the manifest", () => {
		// Given
		const manifest = new Map(readManifestCopy().map((entry) => [entry.method, entry.tier]));

		// When
		const tables = resolveTiers(readManifestCopy());

		// Then
		const mismatched = Object.entries(CHAIN_BINDINGS).flatMap(([surface, bindings]) =>
			bindings
				.filter((binding) => binding.source !== null)
				.filter((binding) => {
					const row = tables[surface as keyof typeof tables].find(([method]) => method === binding.method);
					return row?.[1] !== manifest.get(binding.source ?? "");
				})
				.map((binding) => `${surface}.${binding.method}`),
		);
		expect(mismatched).toEqual([]);
	});

	it("composes helpers only from read-tier manifest methods", () => {
		const tiers = new Map(readManifestCopy().map((entry) => [entry.method, entry.tier]));
		expect(COMPOSED_HELPERS.map((helper) => tiers.get(helper.source))).toEqual(COMPOSED_HELPERS.map(() => "read"));
	});
});

describe("generated kernel facades", () => {
	it("sends computer.window({app}) as exactly one tool.computer call chain", async () => {
		// Given
		const kernel = loadJsFacade(windowResponder);

		// When
		await kernel.run(`await computer.window({ app: "X" });`);

		// Then
		expect(kernel.calls).toEqual([{ action: "call", chain: [{ method: "window", args: [{ app: "X" }] }] }]);
	});

	it("sends win.drill(ref) as a window-hopped ax snapshot rooted at the ref in JavaScript", async () => {
		// Given
		const kernel = loadJsFacade(windowResponder);

		// When
		await kernel.run(`const win = await computer.window("w1"); await win.drill("e4", { maxDepth: 2 });`);

		// Then
		expect(kernel.calls.at(-1)).toEqual({
			action: "call",
			chain: [
				{ method: "window", args: ["w1"] },
				{ method: "ax", args: [{ maxDepth: 2, root: "e4" }] },
			],
		});
	});

	it("sends win.drill(ref) as a window-hopped ax snapshot rooted at the ref in Python", () => {
		// When
		const run = runPythonFacade("win = computer.window('w1')\nwin.drill('e4', maxDepth=2)");

		// Then
		expect(run.error).toBeNull();
		expect(run.calls.at(-1)).toEqual({
			action: "call",
			chain: [
				{ method: "window", args: ["w1"] },
				{ method: "ax", args: [{ maxDepth: 2, root: "e4" }] },
			],
		});
	});

	it("forwards observe({ since }) unchanged in both facades", async () => {
		// Given
		const kernel = loadJsFacade(windowResponder);

		// When
		await kernel.run(`await (await computer.window("w1")).observe({ since: 3 });`);
		const run = runPythonFacade("computer.window('w1').observe(since=3)");

		// Then
		const expected = { action: "call", chain: [{ method: "window", args: ["w1"] }, { method: "observe", args: [{ since: 3 }] }] };
		expect({ js: kernel.calls.at(-1), py: run.calls.at(-1) }).toEqual({ js: expected, py: expected });
	});

	it("defines no epoch helper", async () => {
		const kernel = loadJsFacade(windowResponder);
		expect(await kernel.run("return typeof computer.epoch;")).toBe("undefined");
		expect(runPythonFacade("out = hasattr(computer, 'epoch')").out).toBe(false);
	});
});

describe("computer.verify", () => {
	const enabledAfter = (reads: number) => {
		let count = 0;
		return (args: Record<string, unknown>): ToolResult => {
			count += 1;
			const chain = args.chain as { method: string }[];
			if (chain.length === 1 && chain[0]?.method === "ref") {
				return { text: "", details: { value: { ...ELEMENT_SNAPSHOT, enabled: count >= reads } } };
			}
			return { text: "" };
		};
	};

	it("returns satisfied once a read shows the state, sending only read chains", async () => {
		// Given
		const kernel = loadJsFacade(enabledAfter(3));

		// When
		const verdict = await kernel.run(
			`return computer.verify({ kind: "elementEnabled", ref: "e1" }, { timeoutMs: 2000, intervalMs: 10 });`,
		);

		// Then
		expect(verdict).toMatchObject({ status: "satisfied", reads: 3 });
		expect(kernel.calls.every((call) => JSON.stringify(call) === JSON.stringify({ action: "call", chain: [{ method: "ref", args: ["e1"] }] }))).toBe(true);
	});

	it("returns unsatisfied when the deadline passes without the state", async () => {
		// Given
		const kernel = loadJsFacade(enabledAfter(Number.POSITIVE_INFINITY));

		// When
		const verdict = (await kernel.run(
			`return computer.verify({ kind: "elementEnabled", ref: "e1" }, { timeoutMs: 50, intervalMs: 10 });`,
		)) as { status: string; reads: number };

		// Then
		expect(verdict.status).toBe("unsatisfied");
		expect(verdict.reads).toBeGreaterThan(1);
	});

	it("returns unknown with the cause when a read fails", async () => {
		// Given
		const kernel = loadJsFacade(() => ({ text: "Suspended: the user pressed the stop chord", hasError: true }));

		// When
		const verdict = await kernel.run(`return computer.verify({ kind: "windowExists", window: { app: "Code" } });`);

		// Then
		expect(verdict).toMatchObject({ status: "unknown", reads: 1, cause: "Suspended: the user pressed the stop chord" });
	});

	it("treats a StaleRef read as the element being gone", async () => {
		// Given
		const kernel = loadJsFacade(() => ({ text: "StaleRef: e1 no longer resolves", hasError: true }));

		// When
		const verdict = await kernel.run(`return computer.verify({ kind: "elementExists", ref: "e1", exists: false });`);

		// Then
		expect(verdict).toMatchObject({ status: "satisfied", reads: 1 });
	});

	it("matches windows by filter in Python and returns the same verdict shape", () => {
		// Given
		const windows = JSON.stringify({ text: "", details: { value: [WINDOW_SNAPSHOT] }, images: [], hasError: false });

		// When
		const run = runPythonFacade("out = computer.verify({'kind': 'windowExists', 'window': {'app': 'code'}}, timeoutMs=0)", {
			windows,
		});

		// Then
		expect(run.error).toBeNull();
		expect(run.out).toMatchObject({ status: "satisfied", reads: 1 });
		expect(run.calls).toEqual([{ action: "call", chain: [{ method: "windows", args: [] }] }]);
	});

	it("refuses an unknown expectation kind before any tool call", async () => {
		const kernel = loadJsFacade(windowResponder);
		await expect(kernel.run(`return computer.verify({ kind: "pixelMatches" });`)).rejects.toThrow(TypeError);
		expect(kernel.calls).toEqual([]);
	});
});

describe("SENPI_DESKTOP_HOST marker", () => {
	it("is set in the JavaScript kernel's environment at install", () => {
		// Given
		const env: Record<string, string> = {};

		// When
		new Function("globalThis", computerPreludeAssets.javascript)({ tool: {}, display: () => {}, process: { env } });

		// Then
		expect(env.SENPI_DESKTOP_HOST).toBe("1");
	});

	it("reaches a child process a JavaScript cell starts", () => {
		// Given: a real runtime installs the prelude on its own global, then spawns a child
		const script = `
			new Function("globalThis", ${JSON.stringify(computerPreludeAssets.javascript)})(globalThis);
			const { spawnSync } = require("node:child_process");
			const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.env.SENPI_DESKTOP_HOST))"], { encoding: "utf8" });
			process.stdout.write(child.stdout);
		`;
		const env = { ...process.env };
		delete env.SENPI_DESKTOP_HOST;

		// When
		const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", env, timeout: 30_000 });

		// Then
		expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "1" });
	});

	it("reaches a child process a Python cell starts", () => {
		// When
		const run = runPythonFacade(
			"import subprocess, sys\nout = subprocess.run([sys.executable, '-c', 'import os; print(os.environ.get(\"SENPI_DESKTOP_HOST\"))'], capture_output=True, text=True).stdout.strip()",
		);

		// Then
		expect(run.out).toBe("1");
	});
});
