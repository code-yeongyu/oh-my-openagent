import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_STDOUT_LIMIT_BYTES = 64 * 1024;
export const DEFAULT_STDERR_LIMIT_BYTES = 64 * 1024;

export type HookOutputPolicy = {
	readonly maxStdoutBytes?: number;
	readonly maxStderrBytes?: number;
	readonly spillDir?: string;
};

export type HookStreamSafetyMetadata = {
	readonly originalBytes: number;
	readonly returnedBytes: number;
	readonly redacted: boolean;
	readonly spilled: boolean;
	readonly truncated: boolean;
	readonly spillPath?: string;
};

export type HookOutputSafetyMetadata = {
	readonly stdout: HookStreamSafetyMetadata;
	readonly stderr: HookStreamSafetyMetadata;
};

export type HookSafeOutput = {
	readonly text: string;
	readonly safety: HookStreamSafetyMetadata;
};

export function applyHookOutputSafety(
	stream: "stderr" | "stdout",
	text: string,
	policy: HookOutputPolicy | undefined,
	capture?: { readonly originalBytes: number; readonly truncated: boolean },
): HookSafeOutput {
	const originalBytes = capture?.originalBytes ?? Buffer.byteLength(text);
	const redactedText = redactHookOutput(text);
	const redacted = redactedText !== text;
	const limit = stream === "stdout" ? policy?.maxStdoutBytes : policy?.maxStderrBytes;
	const maxBytes = limit ?? (stream === "stdout" ? DEFAULT_STDOUT_LIMIT_BYTES : DEFAULT_STDERR_LIMIT_BYTES);
	const redactedBytes = Buffer.byteLength(redactedText);
	const truncated = capture?.truncated === true || redactedBytes > maxBytes;
	const spillPath = truncated ? spillRedactedOutput(stream, redactedText, policy) : undefined;
	const returnedText = truncated ? Buffer.from(redactedText).subarray(0, maxBytes).toString("utf8") : redactedText;
	return {
		safety: {
			originalBytes,
			redacted,
			returnedBytes: Buffer.byteLength(returnedText),
			spilled: spillPath !== undefined,
			...(spillPath === undefined ? {} : { spillPath }),
			truncated,
		},
		text: returnedText,
	};
}

function redactHookOutput(text: string): string {
	return redactHookTokenValues(
		text
			.replace(/\b([A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|AUTH)[A-Z0-9_]*)=([^\s'"]+)/g, "$1=[REDACTED]")
			.replace(/\b(Authorization:\s*Bearer\s+)([^\s'"]+)/gi, "$1[REDACTED]")
			.replace(/\b(Bearer\s+)(sk-[A-Za-z0-9._-]+)/g, "$1[REDACTED]"),
	);
}

export function redactHookTokenValues(text: string, replacement = "[REDACTED]"): string {
	return text
		.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, replacement)
		.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement);
}

function spillRedactedOutput(stream: "stderr" | "stdout", text: string, policy: HookOutputPolicy | undefined): string {
	const spillDir = policy?.spillDir ?? join(tmpdir(), "senpi-hook-output");
	mkdirSync(spillDir, { recursive: true });
	const path = join(spillDir, `hook-${stream}-${process.pid}-${randomUUID()}.txt`);
	writeFileSync(path, text);
	return path;
}
