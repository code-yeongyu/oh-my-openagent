import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ULW_LOOP_LOCK_TIMEOUT_CODE, withStateLock, withStateLockSync } from "../src/state-lock.ts";
import { UlwLoopError } from "../src/types.ts";

let workDir: string;
let lockPath: string;
const children: ChildProcess[] = [];

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "ulw-state-lock-"));
	lockPath = join(workDir, ".omo", "ulw-loop", "s1", ".state.lock");
});

afterEach(async () => {
	for (const child of children.splice(0)) {
		if (child.exitCode === null) child.kill("SIGKILL");
	}
	await rm(workDir, { recursive: true, force: true });
});

const HOLDER_SCRIPT = `
const fs = require("node:fs");
const [lockPath, holdMs] = process.argv.slice(1);
fs.mkdirSync(require("node:path").dirname(lockPath), { recursive: true });
const fd = fs.openSync(lockPath, "wx");
fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: "holder-" + process.pid }));
fs.closeSync(fd);
process.stdout.write("HELD\\n");
setTimeout(() => {
	fs.writeFileSync(lockPath + ".released", "");
	fs.unlinkSync(lockPath);
}, Number(holdMs));
`;

interface ForeignHolder {
	readonly released: () => boolean;
}

// A real second process holds the lock file the way another CLI invocation
// would. Release is observed through a marker file so the check also works
// while the synchronous acquirer has the event loop blocked.
function spawnForeignHolder(holdMs: number): Promise<ForeignHolder> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["-e", HOLDER_SCRIPT, lockPath, String(holdMs)], {
			stdio: ["ignore", "pipe", "inherit"],
		});
		children.push(child);
		let output = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			output += chunk;
			if (output.includes("HELD")) resolve({ released: () => existsSync(`${lockPath}.released`) });
		});
		child.once("error", reject);
	});
}

function spawnExitedProcess(): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
		child.once("exit", () => {
			if (child.pid === undefined) reject(new Error("child had no pid"));
			else resolve(child.pid);
		});
		child.once("error", reject);
	});
}

function ownerPid(): number {
	const record: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
	if (typeof record !== "object" || record === null || !("pid" in record) || typeof record.pid !== "number") {
		throw new Error("lock record has no pid");
	}
	return record.pid;
}

function manualClock() {
	let now = Date.now();
	const tasks = new Set<{ at: number; fn: () => void }>();
	return {
		now: () => now,
		schedule(fn: () => void, ms: number) {
			const task = { at: now + ms, fn };
			tasks.add(task);
			return { unref() {}, cancel: () => tasks.delete(task) };
		},
		advance(ms: number) {
			const end = now + ms;
			for (;;) {
				const next = [...tasks].filter((task) => task.at <= end).sort((a, b) => a.at - b.at)[0];
				if (next === undefined) break;
				now = next.at;
				tasks.delete(next);
				next.fn();
			}
			now = end;
		},
	};
}

describe("#given lease-based ownership", () => {
	it("#when (1) a live owner's lease expired #then an async waiter reclaims it", async () => {
		const clock = manualClock();
		mkdirSync(join(workDir, ".omo", "ulw-loop", "s1"), { recursive: true });
		await writeFile(
			lockPath,
			JSON.stringify({
				pid: process.pid,
				token: "expired",
				createdAt: new Date().toISOString(),
				leaseUntil: clock.now() - 1,
			}),
		);
		await expect(withStateLock(lockPath, async () => "acquired", { clock, leaseMs: 90, timeoutMs: 0 })).resolves.toBe(
			"acquired",
		);
	});

	it("#when (2) reclaimed while owner alive #then its heartbeat never overwrites or recreates the successor path", async () => {
		const clock = manualClock();
		await withStateLock(
			lockPath,
			async () => {
				const initial = JSON.parse(readFileSync(lockPath, "utf8"));
				expect(initial.leaseUntil).toBe(clock.now() + 90);
				await withStateLock(
					lockPath,
					async () => {
						const successor = readFileSync(lockPath, "utf8");
						clock.advance(30);
						expect(readFileSync(lockPath, "utf8")).toBe(successor);
					},
					{ leaseMs: 900, heartbeatMs: 0, timeoutMs: 0, clock: { ...clock, now: () => clock.now() + 91 } },
				);
				clock.advance(30);
				expect(existsSync(lockPath)).toBe(false);
			},
			{ clock, leaseMs: 90 },
		);
	});

	it("#when (3) the clock passes the original lease #then a refreshing holder cannot be reclaimed", async () => {
		const clock = manualClock();
		await withStateLock(
			lockPath,
			async () => {
				clock.advance(120);
				await expect(withStateLock(lockPath, async () => "stolen", { clock, timeoutMs: 0 })).rejects.toMatchObject({
					code: ULW_LOOP_LOCK_TIMEOUT_CODE,
				});
			},
			{ clock, leaseMs: 90 },
		);
	});

	it("#when acquisition hands off to its body #then ownership uses the acquired token rather than rereading a successor", async () => {
		await withStateLock(lockPath, async (token: string) => {
			expect(token).toBe(JSON.parse(readFileSync(lockPath, "utf8")).token);
		});
	});

	it("#when (4) a synchronous holder runs #then it writes a lease-less record", () => {
		withStateLockSync(lockPath, () => {
			expect(JSON.parse(readFileSync(lockPath, "utf8"))).not.toHaveProperty("leaseUntil");
		});
	});
});

describe("withStateLock", () => {
	describe("#given a lock held by another live process", () => {
		it("#when acquiring #then it waits for that process to release before running the body", async () => {
			const holder = await spawnForeignHolder(300);

			const observedReleaseFirst = await withStateLock(lockPath, async () => holder.released(), {
				timeoutMs: 5_000,
			});

			expect(observedReleaseFirst).toBe(true);
			expect(existsSync(lockPath)).toBe(false);
		});

		it("#when the holder outlives the timeout #then it fails closed without running the body", async () => {
			await spawnForeignHolder(5_000);
			let bodyRan = false;

			const attempt = withStateLock(
				lockPath,
				async () => {
					bodyRan = true;
				},
				{ timeoutMs: 150 },
			);

			await expect(attempt).rejects.toMatchObject({ code: ULW_LOOP_LOCK_TIMEOUT_CODE });
			await expect(attempt).rejects.toBeInstanceOf(UlwLoopError);
			expect(bodyRan).toBe(false);
			expect(existsSync(lockPath)).toBe(true);
		});
	});

	describe("#given a lock left behind by a process that is gone", () => {
		it("#when acquiring #then the stale lock is reclaimed immediately", async () => {
			const deadPid = await spawnExitedProcess();
			mkdirSync(join(workDir, ".omo", "ulw-loop", "s1"), { recursive: true });
			await writeFile(
				lockPath,
				JSON.stringify({ pid: deadPid, createdAt: new Date().toISOString(), token: "gone" }),
			);

			const seenOwner = await withStateLock(lockPath, async () => ownerPid(), { timeoutMs: 1_000 });

			expect(seenOwner).toBe(process.pid);
		});

		it("#when a legacy record without a token is young #then it is treated as mid-write and waited on, not stolen", async () => {
			mkdirSync(join(workDir, ".omo", "ulw-loop", "s1"), { recursive: true });
			await writeFile(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));

			const attempt = withStateLock(lockPath, async () => "unreachable", { timeoutMs: 150, staleMs: 60_000 });

			await expect(attempt).rejects.toMatchObject({ code: ULW_LOOP_LOCK_TIMEOUT_CODE });
			expect(existsSync(lockPath)).toBe(true);
		});
	});

	describe("#given a live holder whose lock is older than staleMs", () => {
		it("#when acquiring #then age alone never reclaims it and the waiter fails closed", async () => {
			await spawnForeignHolder(5_000);
			const holderPid = ownerPid();
			const twoMinutesAgo = new Date(Date.now() - 120_000);
			await utimes(lockPath, twoMinutesAgo, twoMinutesAgo);
			let bodyRan = false;

			const attempt = withStateLock(
				lockPath,
				async () => {
					bodyRan = true;
				},
				{ timeoutMs: 200, staleMs: 60_000 },
			);

			await expect(attempt).rejects.toMatchObject({ code: ULW_LOOP_LOCK_TIMEOUT_CODE });
			expect(bodyRan).toBe(false);
			expect(ownerPid()).toBe(holderPid);
		});
	});

	describe("#given the lock changed hands while the body ran", () => {
		it("#when the original owner releases #then it leaves the successor's lock in place", async () => {
			const foreign = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: "successor" });

			await withStateLock(lockPath, async () => {
				await writeFile(lockPath, foreign);
			});

			expect(existsSync(lockPath)).toBe(true);
			expect(readFileSync(lockPath, "utf8")).toBe(foreign);
		});

		it("#when the record is unreadable but older than staleMs #then it is reclaimed", async () => {
			mkdirSync(join(workDir, ".omo", "ulw-loop", "s1"), { recursive: true });
			await writeFile(lockPath, "not json");
			const twoMinutesAgo = new Date(Date.now() - 120_000);
			await utimes(lockPath, twoMinutesAgo, twoMinutesAgo);

			const seenOwner = await withStateLock(lockPath, async () => ownerPid(), {
				timeoutMs: 1_000,
				staleMs: 60_000,
			});

			expect(seenOwner).toBe(process.pid);
		});
	});

	describe("#given the body throws", () => {
		it("#when it rejects #then the lock is released and the error propagates", async () => {
			const failure = withStateLock(lockPath, async () => {
				throw new Error("body exploded");
			});

			await expect(failure).rejects.toThrow("body exploded");
			expect(existsSync(lockPath)).toBe(false);
		});
	});
});

describe("withStateLockSync", () => {
	it("#given a lock held by another live process #when acquiring #then it blocks until release", async () => {
		const holder = await spawnForeignHolder(300);

		const observedReleaseFirst = withStateLockSync(lockPath, () => holder.released(), { timeoutMs: 5_000 });

		expect(observedReleaseFirst).toBe(true);
		expect(existsSync(lockPath)).toBe(false);
	});

	it("#given the holder outlives the timeout #when acquiring #then it throws the timeout error", async () => {
		await spawnForeignHolder(5_000);

		expect(() => withStateLockSync(lockPath, () => "unreachable", { timeoutMs: 150 })).toThrow(
			expect.objectContaining({ code: ULW_LOOP_LOCK_TIMEOUT_CODE }),
		);
	});
});
