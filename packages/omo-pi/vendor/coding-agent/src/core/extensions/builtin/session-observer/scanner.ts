import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { getSessionsDir } from "../../../../config.ts";
import type { FileEntry, SessionHeader } from "../../../session-manager.ts";
import { parseSessionEntries } from "../../../session-manager.ts";
import { compactWhitespace, getTextContent } from "./text.ts";
import type { SessionHudEntry } from "./types.ts";

interface PathLike {
	resolve(path: string): string;
	relative(from: string, to: string): string;
	isAbsolute(path: string): boolean;
}

export function resolveSessionHudRoot(
	currentSessionDir: string,
	defaultSessionsRoot: string = getSessionsDir(),
	pathImpl: PathLike = { resolve, relative, isAbsolute },
): string {
	const defaultRoot = pathImpl.resolve(defaultSessionsRoot);
	if (!currentSessionDir) return defaultRoot;
	const current = pathImpl.resolve(currentSessionDir);
	if (current === defaultRoot) return defaultRoot;
	const rel = pathImpl.relative(defaultRoot, current);
	if (rel && !rel.startsWith("..") && !pathImpl.isAbsolute(rel)) return defaultRoot;
	return current;
}

function hasErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

async function readDirIfExists(path: string): Promise<readonly string[]> {
	try {
		return await readdir(path);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw error;
	}
}

async function statIfFile(path: string): Promise<Stats | undefined> {
	try {
		const fileStat = await stat(path);
		return fileStat.isFile() ? fileStat : undefined;
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return undefined;
		throw error;
	}
}

async function collectFilesInDir(dir: string): Promise<readonly string[]> {
	const names = await readDirIfExists(dir);
	const files: string[] = [];
	for (const name of names) {
		if (!name.endsWith(".jsonl")) continue;
		const file = join(dir, name);
		if (await statIfFile(file)) files.push(file);
	}
	return files;
}

async function discoverSessionFiles(root: string): Promise<readonly string[]> {
	const names = await readDirIfExists(root);
	const files: string[] = [...(await collectFilesInDir(root))];
	for (const name of names) {
		if (name.endsWith(".jsonl")) continue;
		const dir = join(root, name);
		try {
			const dirStat = await stat(dir);
			if (dirStat.isDirectory()) files.push(...(await collectFilesInDir(dir)));
		} catch (error) {
			if (!hasErrorCode(error, "ENOENT")) throw error;
		}
	}
	return files;
}

function firstHeader(entries: readonly FileEntry[], filePath: string): SessionHeader | undefined {
	const header = entries[0];
	if (header?.type === "session") return header;
	if (entries.length === 0) return undefined;
	return { type: "session", id: basename(filePath, ".jsonl"), timestamp: new Date(0).toISOString(), cwd: "" };
}

function lastUserText(entries: readonly FileEntry[]): string {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user") continue;
		const text = compactWhitespace(getTextContent(message.content));
		if (text) return text;
	}
	return "(no user prompt)";
}

function latestMessageTimestamp(entries: readonly FileEntry[], fallback: number): number {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry || entry.type === "session") continue;
		const timestamp = Date.parse(entry.timestamp);
		if (Number.isFinite(timestamp)) return timestamp;
	}
	return fallback;
}

async function summarizeSession(
	filePath: string,
	currentSessionFile: string | undefined,
): Promise<SessionHudEntry | undefined> {
	const [content, fileStat] = await Promise.all([readFile(filePath, "utf-8"), stat(filePath)]);
	const entries = parseSessionEntries(content);
	const header = firstHeader(entries, filePath);
	if (!header) return undefined;
	const messageCount = entries.filter((entry) => entry.type === "message").length;
	return {
		id: header.id,
		shortId: header.id.length <= 8 ? header.id : header.id.slice(0, 8),
		path: filePath,
		cwd: header.cwd,
		createdAt: Date.parse(header.timestamp),
		modifiedAt: latestMessageTimestamp(entries, fileStat.mtime.getTime()),
		messageCount,
		lastUserText: lastUserText(entries),
		isCurrent: currentSessionFile === filePath,
	};
}

export async function scanSessionHudEntries(
	root: string,
	currentSessionFile?: string,
): Promise<readonly SessionHudEntry[]> {
	const files = await discoverSessionFiles(root);
	const sessions: SessionHudEntry[] = [];
	for (const file of files) {
		try {
			const session = await summarizeSession(file, currentSessionFile);
			if (session) sessions.push(session);
		} catch (error) {
			if (!hasErrorCode(error, "ENOENT")) throw error;
		}
	}
	sessions.sort((left, right) => right.modifiedAt - left.modifiedAt);
	return sessions;
}
