import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { isPlainRecord } from "@oh-my-opencode/mcp-stdio-core/record";

import type { DaemonPaths } from "./paths.js";

export const OMO_DAEMON_PROTOCOL_VERSION = 1;
export const AUTH_ERROR_CODE = -32001;
export const PROTOCOL_ERROR_CODE = -32002;

export type DaemonAuthEnvelope = {
	readonly protocolVersion: typeof OMO_DAEMON_PROTOCOL_VERSION;
	readonly token: string;
};

export type JsonRpcErrorResponse = {
	readonly jsonrpc: "2.0";
	readonly id: string | number | null;
	readonly error: {
		readonly code: number;
		readonly message: string;
		readonly data: { readonly code: string };
	};
};

export type AuthenticatedMessage = {
	readonly input: Record<string, unknown>;
	readonly id: string | number | null;
	readonly method: string | undefined;
};

const AUTH_TOKEN_BYTES = 32;

export function authEnvelope(token: string): DaemonAuthEnvelope {
	return { protocolVersion: OMO_DAEMON_PROTOCOL_VERSION, token };
}

export function readAuthToken(paths: DaemonPaths): string | null {
	try {
		const token = readFileSync(paths.auth, "utf8").trim();
		return token.length > 0 ? token : null;
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

export function readOrCreateAuthToken(paths: DaemonPaths): string {
	const existing = readAuthToken(paths);
	if (existing) return existing;
	return createAuthToken(paths);
}

export function rotateAuthToken(paths: DaemonPaths): string {
	try {
		unlinkSync(paths.auth);
	} catch (error) {
		if (!(error instanceof Error)) throw error;
	}
	return createAuthToken(paths);
}

export function authenticateMessage(raw: unknown, expectedToken: string): AuthenticatedMessage | JsonRpcErrorResponse {
	const id = jsonRpcId(raw);
	if (!isPlainRecord(raw)) return authError(id);
	const params = raw["params"];
	if (!isPlainRecord(params)) return authError(id);
	const envelope = params["_omo"];
	if (!isPlainRecord(envelope)) return authError(id);
	const protocolVersion = envelope["protocolVersion"];
	if (protocolVersion !== OMO_DAEMON_PROTOCOL_VERSION) return protocolError(id);
	const token = envelope["token"];
	if (typeof token !== "string" || !tokenMatches(token, expectedToken)) return authError(id);
	const cleanParams: Record<string, unknown> = { ...params };
	delete cleanParams["_omo"];
	return { input: { ...raw, params: cleanParams }, id, method: typeof raw["method"] === "string" ? raw["method"] : undefined };
}

export function isAuthErrorResponse(message: unknown): boolean {
	if (!isPlainRecord(message)) return false;
	const error = message["error"];
	if (!isPlainRecord(error)) return false;
	const data = error["data"];
	return error["code"] === AUTH_ERROR_CODE && isPlainRecord(data) && data["code"] === "daemon_authentication_failed";
}

export function writePrivateFile(path: string, data: string): void {
	const fd = openSync(path, "w", 0o600);
	try {
		writeSync(fd, data);
	} finally {
		closeSync(fd);
	}
	setPrivateFileMode(path);
}

export function ensurePrivateDirectory(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") chmodSync(path, 0o700);
}

export function setPrivateFileMode(path: string): void {
	if (process.platform !== "win32") chmodSync(path, 0o600);
}

function createAuthToken(paths: DaemonPaths): string {
	ensurePrivateDirectory(dirname(paths.auth));
	const token = randomBytes(AUTH_TOKEN_BYTES).toString("base64url");
	let fd: number;
	try {
		fd = openSync(paths.auth, "wx", 0o600);
	} catch (error) {
		if (errorCode(error) === "EEXIST") {
			const existing = readAuthToken(paths);
			if (existing) return existing;
		}
		throw error;
	}
	try {
		writeSync(fd, `${token}\n`);
	} finally {
		closeSync(fd);
	}
	setPrivateFileMode(paths.auth);
	return token;
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error)) return undefined;
	const code = Reflect.get(error, "code");
	return typeof code === "string" ? code : undefined;
}

function tokenMatches(candidate: string, expected: string): boolean {
	const candidateBytes = Buffer.from(candidate);
	const expectedBytes = Buffer.from(expected);
	return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

function jsonRpcId(raw: unknown): string | number | null {
	if (!isPlainRecord(raw)) return null;
	const id = raw["id"];
	return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

function authError(id: string | number | null): JsonRpcErrorResponse {
	return {
		jsonrpc: "2.0",
		id,
		error: { code: AUTH_ERROR_CODE, message: "daemon authentication failed", data: { code: "daemon_authentication_failed" } },
	};
}

function protocolError(id: string | number | null): JsonRpcErrorResponse {
	return {
		jsonrpc: "2.0",
		id,
		error: { code: PROTOCOL_ERROR_CODE, message: "daemon protocol mismatch", data: { code: "daemon_protocol_mismatch" } },
	};
}
