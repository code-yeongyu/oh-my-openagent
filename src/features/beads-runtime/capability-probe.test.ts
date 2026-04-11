import { describe, expect, test } from "bun:test";
import type { BeadsRuntimeCommandRunner } from "./br-command-runner";
import {
	assertBeadsRuntimeCapabilities,
	probeBeadsRuntimeCapabilities,
} from "./capability-probe";
import { BeadsRuntimeError } from "./errors";

function createRunner(
	outputs: Record<
		string,
		{ exitCode: number; stdout?: string; stderr?: string }
	>,
): BeadsRuntimeCommandRunner {
	return async ({ command }) =>
		outputs[command.join(" ")] ?? { exitCode: 1, stderr: "missing" };
}

describe("beads runtime capability probe", () => {
	test("passes when required ready and list json help surfaces exist even if show is unavailable", async () => {
		const runner = createRunner({
			"br --help": { exitCode: 0, stdout: "usage" },
			"br ready --help": { exitCode: 0, stdout: "--json" },
			"br list --help": { exitCode: 0, stdout: "--status\n--json" },
			"br show --help": { exitCode: 1, stderr: "unsupported" },
		});

		const result = await probeBeadsRuntimeCapabilities(runner, "/tmp/project");

		expect(result.ok).toBe(true);
		expect(
			result.capabilities.find((capability) => capability.name === "show")
				?.supported,
		).toBe(false);
		expect(() => assertBeadsRuntimeCapabilities(result)).not.toThrow();
	});

	test("fails closed when br itself is unavailable", async () => {
		const result = await probeBeadsRuntimeCapabilities(
			createRunner({
				"br --help": { exitCode: 1, stderr: "command not found" },
			}),
			"/tmp/project",
		);

		expect(result.ok).toBe(false);
		expect(result.binaryAvailable).toBe(false);
		expect(() => assertBeadsRuntimeCapabilities(result)).toThrow(
			BeadsRuntimeError,
		);
	});

	test("fails closed when required json transport flags are missing", async () => {
		const runner = createRunner({
			"br --help": { exitCode: 0, stdout: "usage" },
			"br ready --help": { exitCode: 0, stdout: "plain text only" },
			"br list --help": { exitCode: 0, stdout: "--status\n--json" },
			"br show --help": { exitCode: 0, stdout: "--json" },
		});

		const result = await probeBeadsRuntimeCapabilities(runner, "/tmp/project");

		expect(result.ok).toBe(false);
		expect(
			result.capabilities.find((capability) => capability.name === "ready")
				?.missingFlags,
		).toEqual(["--json"]);
		expect(() => assertBeadsRuntimeCapabilities(result)).toThrow(
			BeadsRuntimeError,
		);
	});
});
