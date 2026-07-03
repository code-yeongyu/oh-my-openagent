import { Buffer } from "node:buffer";
import { type AdapterJsonRpcError, createAdapterJsonRpcError } from "./error-mapper.ts";
import type { ReplayCursor, SessionBinding, SessionBindingInput } from "./session-registry.ts";

const RESUME_TOKEN_VERSION = "2026-06-24.pr-010";

export interface ResumeTokenPayload extends SessionBindingInput {
	readonly version: typeof RESUME_TOKEN_VERSION;
	readonly replayCursor: ReplayCursor;
}

export type ResumeTokenParseResult =
	| { readonly kind: "parsed"; readonly payload: ResumeTokenPayload }
	| { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError };

export function createResumeToken(binding: SessionBinding): string {
	const payload: ResumeTokenPayload = {
		version: RESUME_TOKEN_VERSION,
		externalSessionId: binding.externalSessionId,
		appThreadId: binding.appThreadId,
		appSessionId: binding.appSessionId,
		replayCursor: binding.replayCursor,
	};
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function parseResumeToken(token: string): ResumeTokenParseResult {
	try {
		const parsed: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
		const payload = readResumeTokenPayload(parsed);
		if (!payload) return malformedToken("Resume token payload is malformed.");
		return { kind: "parsed", payload };
	} catch (error) {
		if (error instanceof Error) return malformedToken(error.message);
		throw error;
	}
}

function readResumeTokenPayload(input: unknown): ResumeTokenPayload | undefined {
	const record = readRecord(input);
	if (!record) return undefined;
	const version = readString(record, "version");
	const externalSessionId = readString(record, "externalSessionId");
	const appThreadId = readString(record, "appThreadId");
	const appSessionId = readString(record, "appSessionId");
	const replayCursor = readReplayCursor(record.replayCursor);
	if (version !== RESUME_TOKEN_VERSION || !externalSessionId || !appThreadId || !appSessionId || !replayCursor) {
		return undefined;
	}
	return { version, externalSessionId, appThreadId, appSessionId, replayCursor };
}

function readReplayCursor(input: unknown): ReplayCursor | undefined {
	const record = readRecord(input);
	if (!record) return undefined;
	const lastCompletedTurnId = readString(record, "lastCompletedTurnId");
	const lastProjectedItemId = readString(record, "lastProjectedItemId");
	const lastLosslessSequence = readNumber(record, "lastLosslessSequence");
	return {
		...(lastCompletedTurnId ? { lastCompletedTurnId } : {}),
		...(lastProjectedItemId ? { lastProjectedItemId } : {}),
		...(lastLosslessSequence === undefined ? {} : { lastLosslessSequence }),
	};
}

function malformedToken(message: string): { readonly kind: "adapter-error"; readonly error: AdapterJsonRpcError } {
	return {
		kind: "adapter-error",
		error: createAdapterJsonRpcError({
			adapterCode: "malformed-message",
			message: `Invalid resume token: ${message}`,
		}),
	};
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

function readNumber(input: Readonly<Record<string, unknown>>, key: string): number | undefined {
	const value = input[key];
	return typeof value === "number" ? value : undefined;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return Object.fromEntries(Object.entries(value));
}
