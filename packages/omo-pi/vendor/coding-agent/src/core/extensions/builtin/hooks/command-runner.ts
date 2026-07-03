import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { waitForChildProcess } from "../../../../utils/child-process.ts";
import { killProcessTree, trackDetachedChildPid, untrackDetachedChildPid } from "../../../../utils/shell.ts";
import {
	applyHookOutputSafety,
	buildHookEnvironment,
	DEFAULT_STDERR_LIMIT_BYTES,
	DEFAULT_STDOUT_LIMIT_BYTES,
	type HookOutputPolicy,
	type HookOutputSafetyMetadata,
	resolveHookTimeoutSeconds,
} from "./safety.ts";
import type { ExecutableHookHandler, HookInputWire } from "./types.ts";

export type CommandHookRunOptions = {
	readonly cwd: string;
	readonly envPassthrough?: readonly string[];
	readonly outputPolicy?: HookOutputPolicy;
	readonly signal?: AbortSignal;
	readonly sourceEnv?: NodeJS.ProcessEnv;
};

export type CommandHookRunResult = {
	readonly command: string;
	readonly cwd: string;
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly timedOut: boolean;
	readonly aborted: boolean;
	readonly durationMs: number;
	readonly outputSafety: HookOutputSafetyMetadata;
	readonly timeoutSeconds: number;
};

export async function runCommandHook(
	handler: ExecutableHookHandler,
	input: HookInputWire,
	options: CommandHookRunOptions,
): Promise<CommandHookRunResult> {
	const command = selectCommandForPlatform(handler);
	const startedAt = performance.now();
	const timeoutSeconds = resolveHookTimeoutSeconds(handler);
	if (options.signal?.aborted) {
		return buildResult({
			aborted: true,
			command,
			cwd: options.cwd,
			exitCode: null,
			signal: null,
			startedAt,
			stderr: createEmptyStreamCapture("stderr"),
			stdout: createEmptyStreamCapture("stdout"),
			timedOut: false,
			timeoutSeconds,
			outputPolicy: options.outputPolicy,
		});
	}

	const child = spawn(command, {
		cwd: options.cwd,
		detached: process.platform !== "win32",
		env: buildHookEnvironment({
			envPassthrough: options.envPassthrough,
			handler,
			input,
			sourceEnv: options.sourceEnv ?? process.env,
		}),
		shell: true,
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	if (child.pid !== undefined) trackDetachedChildPid(child.pid);

	const stdout = createBoundedStreamCapture("stdout", options.outputPolicy);
	const stderr = createBoundedStreamCapture("stderr", options.outputPolicy);
	let exitSignal: NodeJS.Signals | null = null;
	let timedOut = false;
	let timeoutHandle: NodeJS.Timeout | undefined;

	const killChild = (): void => {
		if (child.pid !== undefined) killProcessTree(child.pid);
	};
	const onAbort = (): void => killChild();

	try {
		child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));
		child.once("exit", (_code, signal) => {
			exitSignal = signal;
		});

		if (timeoutSeconds > 0) {
			timeoutHandle = setTimeout(() => {
				timedOut = true;
				killChild();
			}, timeoutSeconds * 1000);
		}

		if (options.signal !== undefined) {
			if (options.signal.aborted) onAbort();
			else options.signal.addEventListener("abort", onAbort, { once: true });
		}

		child.stdin?.end(JSON.stringify(input));
		const exitCode = await waitForChildProcess(child);
		return buildResult({
			aborted: options.signal?.aborted === true,
			command,
			cwd: options.cwd,
			exitCode: timedOut || options.signal?.aborted === true ? null : exitCode,
			signal: exitSignal,
			startedAt,
			stderr,
			stdout,
			timedOut,
			timeoutSeconds,
			outputPolicy: options.outputPolicy,
		});
	} finally {
		if (child.pid !== undefined) untrackDetachedChildPid(child.pid);
		if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
		if (options.signal !== undefined) options.signal.removeEventListener("abort", onAbort);
	}
}

export function selectCommandForPlatform(
	handler: ExecutableHookHandler,
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform === "win32" && handler.config.commandWindows !== undefined) {
		return handler.config.commandWindows;
	}
	return handler.config.command;
}

function buildResult(input: {
	readonly command: string;
	readonly cwd: string;
	readonly exitCode: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly timedOut: boolean;
	readonly aborted: boolean;
	readonly startedAt: number;
	readonly stderr: BoundedStreamCapture;
	readonly stdout: BoundedStreamCapture;
	readonly timeoutSeconds: number;
	readonly outputPolicy?: HookOutputPolicy;
}): CommandHookRunResult {
	const stdout = input.stdout.finalize(input.outputPolicy);
	const stderr = input.stderr.finalize(input.outputPolicy);
	return {
		aborted: input.aborted,
		command: input.command,
		cwd: input.cwd,
		durationMs: Math.max(0, performance.now() - input.startedAt),
		exitCode: input.exitCode,
		outputSafety: { stderr: stderr.safety, stdout: stdout.safety },
		signal: input.signal,
		stderr: stderr.text,
		stdout: stdout.text,
		timedOut: input.timedOut,
		timeoutSeconds: input.timeoutSeconds,
	};
}

type BoundedStreamCapture = {
	readonly append: (chunk: Buffer) => void;
	readonly finalize: (policy: HookOutputPolicy | undefined) => ReturnType<typeof applyHookOutputSafety>;
};

function createBoundedStreamCapture(
	stream: "stderr" | "stdout",
	policy: HookOutputPolicy | undefined,
): BoundedStreamCapture {
	const limit =
		stream === "stdout"
			? (policy?.maxStdoutBytes ?? DEFAULT_STDOUT_LIMIT_BYTES)
			: (policy?.maxStderrBytes ?? DEFAULT_STDERR_LIMIT_BYTES);
	const chunks: Buffer[] = [];
	let keptBytes = 0;
	let totalBytes = 0;

	return {
		append(chunk: Buffer): void {
			totalBytes += chunk.length;
			if (keptBytes >= limit) return;
			const bytesToKeep = Math.min(limit - keptBytes, chunk.length);
			chunks.push(Buffer.from(chunk.subarray(0, bytesToKeep)));
			keptBytes += bytesToKeep;
		},
		finalize(finalPolicy: HookOutputPolicy | undefined): ReturnType<typeof applyHookOutputSafety> {
			let text = "";
			for (const chunk of chunks) {
				text += chunk.toString("utf8");
			}
			return applyHookOutputSafety(stream, text, finalPolicy, {
				originalBytes: totalBytes,
				truncated: totalBytes > keptBytes,
			});
		},
	};
}

function createEmptyStreamCapture(stream: "stderr" | "stdout"): BoundedStreamCapture {
	return {
		append(_chunk: Buffer): void {},
		finalize(policy: HookOutputPolicy | undefined): ReturnType<typeof applyHookOutputSafety> {
			return applyHookOutputSafety(stream, "", policy, { originalBytes: 0, truncated: false });
		},
	};
}
