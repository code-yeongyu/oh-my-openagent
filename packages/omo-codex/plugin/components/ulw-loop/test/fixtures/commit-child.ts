import { fork } from "node:child_process";
import { join } from "node:path";

const running = new Set<ReturnType<typeof childWriter>>();
export async function cleanupWriters(): Promise<void> {
	await Promise.all(
		[...running].map(async (writer) => {
			writer.child.kill("SIGKILL");
			await writer.exited;
		}),
	);
}
export function childWriter(rootPath: string, mode: string, now = Date.now()) {
	const child = fork(join(import.meta.dirname, "commit-writer.ts"), [rootPath, mode, String(now)], {
		execPath: "bun",
		execArgv: [],
		stdio: ["ignore", "inherit", "inherit", "ipc"],
	});
	const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
	const seen = new Set<string>();
	child.on("message", (message) => {
		if (typeof message !== "string") return;
		seen.add(message);
		pending.get(message)?.resolve();
	});
	const exited = new Promise<number | null>((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("child exit timed out"));
		}, 15_000);
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timeout);
			running.delete(writer);
			resolve(code);
			for (const [name, waiter] of pending)
				if (!seen.has(name)) waiter.reject(new Error(`child exited before ${name}: ${code}`));
		});
	});
	const writer = {
		child,
		exited,
		wait(name: string) {
			if (seen.has(name)) return Promise.resolve();
			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error(`IPC timeout: ${name}`)), 10_000);
				pending.set(name, {
					resolve: () => {
						clearTimeout(timeout);
						resolve();
					},
					reject: (error) => {
						clearTimeout(timeout);
						reject(error);
					},
				});
			});
		},
	};
	running.add(writer);
	return writer;
}
