import { describe, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	dropTimestampOffsets,
	goldenHostLeaks,
	pinEnginePackage,
	splitStatusChannels,
	statusCounts,
	stopSandboxProcesses,
} from "./fused-equivalence-support.mjs";

const status = (key, text) => ({ type: "extension_ui_request", method: "setStatus", statusKey: key, statusText: text });
const turnEvent = (type) => ({ type });

describe("splitStatusChannels", () => {
	test("#given a channel that published twice #when split #then both snapshots are kept in order and counted", () => {
		const client = {
			turn: [turnEvent("agent_start"), status("memory", "a"), turnEvent("turn_end"), status("memory", "b")],
			surfaces: [{ n: 1 }, { n: 2 }, { n: 3 }],
		};

		const split = splitStatusChannels(client);

		expect(split.turn).toEqual([turnEvent("agent_start"), turnEvent("turn_end")]);
		expect(split.status["setStatus:memory"]).toEqual({ count: 2, snapshots: [status("memory", "a"), status("memory", "b")] });
		expect(split.surfaces).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
	});

	test("#given two runs whose channel counts differ #when split #then the splits differ", () => {
		const once = splitStatusChannels({ turn: [status("memory", "a")] });
		const twice = splitStatusChannels({ turn: [status("memory", "a"), status("memory", "a")] });

		expect(once.status).not.toEqual(twice.status);
	});

	test("#given split observations #when counted #then each O6 client lists its channel counts", () => {
		const O6 = [splitStatusChannels({ turn: [status("memory", "a"), status("goal", "g"), status("memory", "b")] })];

		expect(statusCounts({ O6 })).toEqual([{ "setStatus:memory": 2, "setStatus:goal": 1 }]);
	});
});

describe("stopSandboxProcesses", () => {
	const box = "/sandbox/eq-1";

	test("#given two sandbox processes #when stopped #then both are signalled and none survives", () => {
		const alive = new Set([11, 12]);
		const list = () => [
			...[...alive].map((pid) => ({ pid, command: `node daemon HOME=${box}` })),
			{ pid: 99, command: "unrelated" },
		];

		const stopped = stopSandboxProcesses(box, { list, kill: (pid) => alive.delete(pid), pause: () => {} });

		expect(stopped).toEqual({ signalled: 2, survivors: [], errors: [] });
	});

	test("#given a process that ignores the signal #when the deadline passes #then it is reported as a survivor", () => {
		let clock = 0;

		const stopped = stopSandboxProcesses(box, {
			list: () => [{ pid: 21, command: `x ${box}` }],
			kill: () => {},
			now: () => clock,
			pause: (ms) => {
				clock += ms;
			},
			deadlineMs: 300,
		});

		expect(stopped.signalled).toBe(1);
		expect(stopped.survivors).toEqual([21]);
	});

	test("#given a signal that fails for a reason other than ESRCH #when stopped #then the error is surfaced", () => {
		const alive = new Set([31, 32]);
		const kill = (pid) => {
			alive.delete(pid);
			const error = Object.assign(new Error(pid === 31 ? "gone" : "not permitted"), { code: pid === 31 ? "ESRCH" : "EPERM" });
			throw error;
		};

		const stopped = stopSandboxProcesses(box, {
			list: () => [...alive].map((pid) => ({ pid, command: box })),
			kill,
			pause: () => {},
		});

		expect(stopped.errors).toEqual(["pid 32: not permitted"]);
		expect(stopped.survivors).toEqual([]);
	});
});

describe("dropTimestampOffsets", () => {
	test("#given one ranked commit time rendered as Z, +00:00 and +09:00 #when offsets are dropped #then all three compare equal and other text keeps its offset", () => {
		// git renders a commit's own zone with %cI: +09:00 on a KST host, +00:00 from git < 2.45 in UTC, Z from git >= 2.45.
		// The harness normalizer ranks the date and time but leaves a numeric offset behind the rank token.
		const observed = (suffix) => ({
			timeline: { previousEntryAtISO: `<ts:timeline.previousEntryAtISO:1>${suffix}` },
			list: [`at <ts:entry.timestamp:2>${suffix} and later`],
			note: "meet at 10:00+09:00",
		});

		const utcZ = dropTimestampOffsets(observed(""));

		expect(dropTimestampOffsets(observed("+00:00"))).toEqual(utcZ);
		expect(dropTimestampOffsets(observed("+09:00"))).toEqual(utcZ);
		expect(dropTimestampOffsets(observed("-05:30"))).toEqual(utcZ);
		expect(utcZ.note).toBe("meet at 10:00+09:00");
	});
});

describe("pinEnginePackage", () => {
	const fixture = () => {
		const base = mkdtempSync(join(tmpdir(), "eq-pin-test-"));
		const modules = join(base, "store", "node_modules");
		for (const dir of ["@code-yeongyu/senpi/dist", "@code-yeongyu/senpi-codemode", "chalk"])
			mkdirSync(join(modules, dir), { recursive: true });
		writeFileSync(join(modules, "@code-yeongyu/senpi/package.json"), JSON.stringify({ name: "@code-yeongyu/senpi" }));
		writeFileSync(join(modules, "@code-yeongyu/senpi/dist/cli.js"), "cli");
		return { base, modules, root: join(base, "pin") };
	};

	test("#given an installed package #when pinned #then it is copied to the fixed root with its siblings linked", () => {
		const { base, modules, root } = fixture();
		try {
			const pin = pinEnginePackage(join(modules, "@code-yeongyu/senpi"), { root });

			expect(pin.packageDir).toBe(join(root, "node_modules/@code-yeongyu/senpi"));
			expect(lstatSync(pin.packageDir).isDirectory()).toBe(true);
			expect(realpathSync(pin.packageDir)).toBe(join(realpathSync(root), "node_modules/@code-yeongyu/senpi"));
			expect(readlinkSync(join(root, "node_modules/chalk"))).toBe(realpathSync(join(modules, "chalk")));
			expect(readlinkSync(join(root, "node_modules/@code-yeongyu/senpi-codemode"))).toBe(
				realpathSync(join(modules, "@code-yeongyu/senpi-codemode")),
			);
			pin.release();
			expect(existsSync(root)).toBe(false);
			expect(existsSync(`${root}.lock`)).toBe(false);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	test("#given a live driver holding the root #when another pins #then it is refused", () => {
		const { base, modules, root } = fixture();
		try {
			writeFileSync(`${root}.lock`, `${process.ppid}\n`);

			expect(() => pinEnginePackage(join(modules, "@code-yeongyu/senpi"), { root })).toThrow(/owns/);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});
});

describe("goldenHostLeaks", () => {
	const notice =
		"OmO Native sends anonymous usage telemetry (no prompts, code, file paths, or account data) to PostHog in the United States to improve the product.";

	test("#given observations with the telemetry notice and terminal restore events #when scanned #then each leak is named with its path", () => {
		const observations = {
			O6: [
				{
					turn: [
						{ type: "extension_event", name: "terminal_monitor_state" },
						{ type: "extension_ui_request", method: "notify", message: notice },
						{ type: "extension_event", name: "wake_source_state" },
					],
				},
			],
		};

		expect(goldenHostLeaks(observations)).toEqual([
			{ path: "$.O6[0].turn[0].name", reason: "terminal_monitor_state event" },
			{ path: "$.O6[0].turn[1].message", reason: "telemetry notice" },
			{ path: "$.O6[0].turn[2].name", reason: "wake_source_state event" },
		]);
	});

	test("#given observations that only mention the markers inside other text #when scanned #then nothing is reported", () => {
		const observations = { O1: [{ body: { messages: [{ content: "the terminal_monitor_state event is internal" }] } }] };

		expect(goldenHostLeaks(observations)).toEqual([]);
	});

	test("#given every committed EQ.omo golden #when scanned #then none carries a host-leaked row", () => {
		const root = join(dirname(fileURLToPath(import.meta.url)), "fused-equivalence-golden");
		const goldens = readdirSync(root).flatMap((platform) =>
			readdirSync(join(root, platform))
				.filter((name) => /^E\d+\.json$/.test(name))
				.map((name) => join(platform, name)),
		);
		expect(goldens.length).toBeGreaterThan(0);

		const leaks = goldens.flatMap((file) =>
			goldenHostLeaks(JSON.parse(readFileSync(join(root, file), "utf8")).observations).map((leak) => `${file} ${leak.path}: ${leak.reason}`),
		);

		expect(leaks).toEqual([]);
	});
});
