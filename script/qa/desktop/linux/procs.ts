// Every process the driver starts carries `OMO_DESKTOP_QA_RUN=<run id>` in its environment, so teardown
// can stop what it started and then count, from /proc, anything (grandchildren included) still alive.
import { type ChildProcess, spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";

export const HANG_GUARD_MS = 30_000;
export const RUN_MARKER = "OMO_DESKTOP_QA_RUN";
const POLL_MS = 50;
const KILL_ESCALATION_MS = 5_000;

export interface RunResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

interface Tracked {
	readonly name: string;
	readonly child: ChildProcess;
	output: string;
}

/**
 * Re-checks an OS-level condition (a socket file, an X property, a file another process writes) until it
 * holds. The condition is the synchronization; the 30 s deadline is a hang guard, never a latency assertion.
 */
export async function until(ready: () => boolean | Promise<boolean>, label: string): Promise<void> {
	const deadline = Date.now() + HANG_GUARD_MS;
	while (!(await ready())) {
		if (Date.now() > deadline) throw new Error(`hang guard: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
}

export async function withinHangGuard(settled: Promise<unknown>): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const guard = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, HANG_GUARD_MS);
	});
	await Promise.race([settled, guard]);
	clearTimeout(timer);
}

export function exists(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}

export class Processes {
	private readonly tracked: Tracked[] = [];

	constructor(
		readonly runId: string,
		readonly env: NodeJS.ProcessEnv,
	) {}

	/** The child environment: the base plus `extra`, where `undefined` removes a variable. */
	childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = { ...this.env, [RUN_MARKER]: this.runId };
		for (const [key, value] of Object.entries(extra)) {
			if (value === undefined) delete env[key];
			else env[key] = value;
		}
		return env;
	}

	start(name: string, argv: readonly string[], extra: Record<string, string | undefined> = {}): ChildProcess {
		const [command, ...args] = argv;
		if (command === undefined) throw new Error(`${name}: empty argv`);
		const child = spawn(command, args, { env: this.childEnv(extra), stdio: ["ignore", "pipe", "pipe"], detached: true });
		const tracked: Tracked = { name, child, output: "" };
		const keep = (chunk: Buffer): void => {
			tracked.output = (tracked.output + chunk.toString("utf8")).slice(-4000);
		};
		child.stdout?.on("data", keep);
		child.stderr?.on("data", keep);
		// A missing binary surfaces as a spawn error; record it so the waiting stage reports it instead of crashing.
		child.once("error", (error) => keep(Buffer.from(`spawn ${command}: ${error.message}\n`)));
		this.tracked.push(tracked);
		return child;
	}

	output(child: ChildProcess): string {
		return this.tracked.find((entry) => entry.child === child)?.output ?? "";
	}

	run(argv: readonly string[], extra: Record<string, string | undefined> = {}): Promise<RunResult> {
		const [command, ...args] = argv;
		if (command === undefined) return Promise.reject(new Error("empty argv"));
		return new Promise((resolve) => {
			const child = spawn(command, args, { env: this.childEnv(extra), stdio: ["ignore", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8");
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf8");
			});
			const timer = setTimeout(() => child.kill("SIGKILL"), HANG_GUARD_MS);
			child.once("error", (error) => {
				clearTimeout(timer);
				resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
			});
			child.once("close", (code) => {
				clearTimeout(timer);
				resolve({ code, stdout, stderr });
			});
		});
	}

	/** Pids (other than this driver) whose environment carries this run's marker. */
	marked(): number[] {
		const needle = `${RUN_MARKER}=${this.runId}\0`;
		const pids: number[] = [];
		for (const entry of readdirSync("/proc")) {
			const pid = Number(entry);
			if (!Number.isInteger(pid) || pid === process.pid) continue;
			try {
				if (`${readFileSync(`/proc/${pid}/environ`, "latin1")}\0`.includes(needle)) pids.push(pid);
			} catch {
				// The process exited between the listing and the read, or belongs to another user.
			}
		}
		return pids;
	}

	/** Stops every started process group, newest first, then sweeps marked stragglers. */
	async stopAll(): Promise<string[]> {
		const receipts: string[] = [];
		for (const entry of this.tracked.splice(0).reverse()) {
			const pid = entry.child.pid;
			if (pid === undefined || entry.child.exitCode !== null || entry.child.signalCode !== null) continue;
			const exited = new Promise<void>((resolve) => entry.child.once("exit", () => resolve()));
			signalGroup(pid, "SIGTERM");
			const timer = setTimeout(() => signalGroup(pid, "SIGKILL"), KILL_ESCALATION_MS);
			await exited;
			clearTimeout(timer);
			receipts.push(`stopped ${entry.name} pid ${pid}`);
		}
		for (const pid of this.marked()) {
			const command = commandLine(pid);
			signalGroup(pid, "SIGKILL");
			receipts.push(`killed straggler pid ${pid} (${command})`);
		}
		await until(() => this.marked().length === 0, "marked processes to exit");
		return receipts;
	}
}

function commandLine(pid: number): string {
	try {
		return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
	} catch {
		return "exited";
	}
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
	for (const target of [-pid, pid]) {
		try {
			process.kill(target, signal);
		} catch {
			// Already gone: the group leader exited or never formed a group.
		}
	}
}
