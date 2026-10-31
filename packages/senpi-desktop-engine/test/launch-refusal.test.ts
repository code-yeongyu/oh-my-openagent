import { describe, expect, it } from "vitest";
import { helloDesktopEngine } from "../src/handshake";
import { DesktopLaunchContextError, DesktopLaunchRefusal } from "../src/launch-refusal";
import { legacySelf, legacyUnresolved, refusalChild, refusalRecord } from "./refusal-child";

describe("legacy refusal exit contract", () => {
	for (const [line, reason] of [[legacySelf, "self-responsible"], [legacyUnresolved, "unresolved"]] as const) {
		for (const code of [null, 0, 1, 2, 3]) {
			it(`classifies legacy ${reason} only at exit 1, not ${code}`, () => {
				const parser = new DesktopLaunchRefusal();
				parser.push(line);
				const error = parser.finish(code, null, "fixture exit");
				if (code === 1) expect(error).toMatchObject({ code: "launch-context-unavailable", reason });
				else expect(error).toBeUndefined();
			});
		}
		it(`does not classify legacy ${reason} terminated by a signal`, () => {
			const parser = new DesktopLaunchRefusal();
			parser.push(line);
			expect(parser.finish(1, "SIGTERM", "fixture exit")).toBeUndefined();
		});
	}
});

describe("streamed refusal byte limit", () => {
	for (const bytes of [511, 512, 513]) {
		it(`rejects a ${bytes}-byte non-ASCII record without legacy fallback`, () => {
			// The accepted schema is ASCII-only; malformed multibyte records must not become legacy refusals.
			const prefix = 'SENPI_DESKTOP_LAUNCH_REFUSED {"version":1,"reason":"';
			const suffix = '"}\n';
			const remaining = bytes - Buffer.byteLength(prefix + suffix, "utf8");
			const payload = "\u00e9".repeat(Math.floor(remaining / 2)) + "x".repeat(remaining % 2);
			const record = prefix + payload + suffix;
			expect(Buffer.byteLength(record, "utf8")).toBe(bytes);
			expect(record.length).toBeLessThan(512);
			const parser = new DesktopLaunchRefusal();
			parser.push(prefix + payload.slice(0, 100));
			parser.push(payload.slice(100) + suffix + legacySelf);
			expect(parser.finish(1, null, "fixture exit")).toBeUndefined();
		});
		it(`checks a valid ASCII record at the same ${bytes}-byte boundary`, () => {
			const record = refusalRecord("unresolved");
			const padded = record.replace("{", " ".repeat(bytes - Buffer.byteLength(record, "utf8")) + "{");
			const parser = new DesktopLaunchRefusal();
			parser.push(padded.slice(0, 100));
			parser.push(padded.slice(100));
			const error = parser.finish(1, null, "fixture exit");
			if (bytes <= 512) expect(error).toHaveProperty("reason", "unresolved");
			else expect(error).toBeUndefined();
		});
	}
});

describe("hello helper launch refusal", () => {
	for (const reason of ["self-responsible", "unresolved"]) {
		it(`reports ${reason} from its actual child`, async () => {
			await expect(helloDesktopEngine("/fixture", {
				spawnEngine: () => refusalChild({ stderr: refusalRecord(reason) }),
			})).rejects.toMatchObject({ code: "launch-context-unavailable", reason });
		}, 10_000);
	}
	it("keeps EPIPE subordinate to drained startup refusal", async () => {
		await expect(helloDesktopEngine("/fixture", {
			spawnEngine: () => {
				const child = refusalChild();
				queueMicrotask(() => child.stdin.emit("error", new Error("EPIPE")));
				return child;
			},
		})).rejects.toHaveProperty("code", "launch-context-unavailable");
	}, 10_000);
	it("does not rescue malformed structured output using legacy output", async () => {
		await expect(helloDesktopEngine("/fixture", {
			spawnEngine: () => refusalChild({ stderr: "SENPI_DESKTOP_LAUNCH_REFUSED {}\n" + legacySelf }),
		})).rejects.toHaveProperty("code", "handshake-failed");
	}, 10_000);
	it("does not relabel a valid hello followed by marker text", async () => {
		expect(await helloDesktopEngine("/fixture", {
			spawnEngine: () => refusalChild({ hello: true }),
		})).toHaveProperty("engineVersion", "fixture");
	}, 10_000);
});

describe("user-facing contract (senpi#4990)", () => {
	const action =
		"Restart this host from a local terminal and keep that terminal app running, or use the OmO desktop app (Settings > Restart engine)." +
		" Opening a new terminal or reconnecting to this same host does not repair its launch context.";

	it.each([
		["self-responsible", "Computer use cannot start safely from this host's current macOS launch context."],
		[
			"unresolved",
			"Computer use cannot start safely from this host's current macOS launch context. macOS responsibility could not be resolved.",
		],
	] as const)("carries code, message and action for %s while keeping the message byte-identical", (reason, message) => {
		const error = new DesktopLaunchContextError(reason, "fixture");
		expect(error.userFacing).toEqual({ code: "COMPUTER_LAUNCH_CONTEXT_REQUIRED", message, action });
		expect(error.message).toBe(`COMPUTER_LAUNCH_CONTEXT_REQUIRED: ${message} ${action}`);
	});
});
