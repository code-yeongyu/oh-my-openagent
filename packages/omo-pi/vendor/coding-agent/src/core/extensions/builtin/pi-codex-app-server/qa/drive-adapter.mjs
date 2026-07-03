#!/usr/bin/env node

import { spawn } from "node:child_process";
import { parseArgs, writeCleanupReceipt } from "./drive-adapter-support.mjs";

const HELP_TEXT = `pi-codex-app-server adapter harness

Usage:
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --help
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --external-stdio --app-server-command <path> [--app-server-args <args>]
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --external-websocket <url>
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --external-unix <sock> --app-server-command <path>

Options:
  --help                         Show this help text.
  --external-stdio               Smoke child-process stdio runtime setup.
  --external-websocket <url>     Smoke remote websocket runtime setup.
  --external-unix <path>         Smoke unix proxy runtime setup for this socket path.
  --app-server-command <path>    Codex app-server command or test double.
  --app-server-args <args>       Codex app-server command arguments.
  --app-server-url <url>         Shared Codex app-server websocket URL.
  --timeout-ms <ms>              Setup timeout. Default: 5000.
  --cleanup-receipt <path>       Write teardown evidence for reviewer packets.

Status:
  PR-004 runtime smoke plus PR-010 reconnect/resume evidence support. Use
  write-evidence-packet.mjs for PR-012 redaction packets. Final PR-013
  compatibility evidence remains deferred.
`;

const CHILD_HEALTH_WINDOW_MS = 100;

async function main(argv) {
	if (argv.length === 0 || argv.includes("--help")) {
		process.stdout.write(HELP_TEXT);
		return 0;
	}

	const args = parseArgs(argv);
	const cleanup = {
		childProcesses: 0,
		websockets: 0,
		ownedSockets: 0,
		externalSocketPathsReferenced: args.externalUnix ? 1 : 0,
	};
	try {
		if (args.externalStdio) {
			await smokeChildProcess(args, cleanup, args.appServerArgs);
			process.stdout.write("PASS stdio runtime smoke\n");
			return 0;
		}
		if (args.externalUnix) {
			await smokeChildProcess(args, cleanup, ["app-server", "proxy", "--sock", args.externalUnix]);
			process.stdout.write("PASS unix proxy runtime smoke\n");
			return 0;
		}
		if (args.externalWebsocket || args.appServerUrl) {
			await smokeWebSocket(args.externalWebsocket || args.appServerUrl, args.timeoutMs, cleanup);
			process.stdout.write("PASS websocket runtime smoke\n");
			return 0;
		}
		process.stderr.write("No PR-004 runtime smoke mode selected.\n");
		return 2;
	} finally {
		if (args.cleanupReceipt) {
			writeCleanupReceipt(args.cleanupReceipt, cleanup);
		}
	}
}

async function smokeChildProcess(args, cleanup, commandArgs) {
	if (!args.appServerCommand) {
		throw new Error("--app-server-command is required for child-process transport smoke.");
	}
	const child = spawn(args.appServerCommand, commandArgs, { stdio: "pipe" });
	let childStarted = false;
	let childTracked = false;
	try {
		await new Promise((resolve, reject) => {
			let settled = false;
			let healthWindow;
			const timeout = setTimeout(() => {
				void finish(new Error(`child process health timeout after ${args.timeoutMs}ms`));
			}, args.timeoutMs);
			const finish = async (error) => {
				if (settled) return;
				settled = true;
				clear();
				if (error) {
					if (childStarted) {
						await stopChild(child);
					} else {
						child.kill("SIGTERM");
					}
					if (childTracked) {
						cleanup.childProcesses -= 1;
						childTracked = false;
					}
					reject(error);
					return;
				}
				resolve();
			};
			const onSpawn = () => {
				childStarted = true;
				childTracked = true;
				cleanup.childProcesses += 1;
				healthWindow = setTimeout(() => {
					void finish();
				}, CHILD_HEALTH_WINDOW_MS);
				healthWindow.unref();
			};
			const onError = (error) => {
				void finish(error);
			};
			const onExit = (code, signal) => {
				if (childTracked) {
					cleanup.childProcesses -= 1;
					childTracked = false;
				}
				if (code !== null) {
					void finish(new Error(`child process exited before health window with code ${code}`));
					return;
				}
				void finish(new Error(`child process exited before health window from signal ${signal}`));
			};
			const clear = () => {
				clearTimeout(timeout);
				clearTimeout(healthWindow);
				child.off("spawn", onSpawn);
				child.off("error", onError);
				child.off("exit", onExit);
			};

			child.once("spawn", onSpawn);
			child.once("error", onError);
			child.once("exit", onExit);
		});
	} finally {
		if (childStarted && child.exitCode === null && child.signalCode === null) {
			await stopChild(child);
			if (childTracked) {
				cleanup.childProcesses -= 1;
			}
		}
	}
}

function stopChild(child) {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
		}, 1000);
		child.once("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
		child.kill("SIGTERM");
	});
}

function smokeWebSocket(url, timeoutMs, cleanup) {
	if (!url) {
		throw new Error("--external-websocket or --app-server-url is required for websocket transport smoke.");
	}
	if (!globalThis.WebSocket) {
		throw new Error("WebSocket is unavailable in this Node runtime.");
	}
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		let settled = false;
		let tracked = true;
		cleanup.websockets += 1;
		const timeout = setTimeout(() => {
			void finish(new Error(`websocket connect timeout after ${timeoutMs}ms`));
		}, timeoutMs);
		const clear = () => {
			clearTimeout(timeout);
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("error", onError);
			socket.removeEventListener("close", onClose);
		};
		const finish = async (error) => {
			if (settled) return;
			settled = true;
			clear();
			await closeWebSocket(socket, error ? "runtime_smoke_failed" : "runtime_smoke_done");
			if (tracked) {
				cleanup.websockets -= 1;
				tracked = false;
			}
			if (error) {
				reject(error);
				return;
			}
			resolve();
		};
		const onOpen = () => {
			void finish();
		};
		const onError = () => {
			void finish(new Error("websocket connection failed"));
		};
		const onClose = () => {
			void finish(new Error("websocket closed before opening"));
		};
		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
		socket.addEventListener("close", onClose);
	});
}

function closeWebSocket(socket, reason) {
	return new Promise((resolve) => {
		if (socket.readyState === 3) {
			resolve();
			return;
		}
		const timeout = setTimeout(resolve, 1000);
		const onClose = () => {
			clearTimeout(timeout);
			resolve();
		};
		socket.addEventListener("close", onClose, { once: true });
		socket.close(1000, reason);
	});
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
