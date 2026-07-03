import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { HistoryEntry } from "./types.ts";

const MAX_HISTORY_ENTRIES = 10_000;
const SYSTEM_PREFIXES: readonly string[] = ["[SYSTEM DIRECTIVE", "[system:", "[SYSTEM"];

type SessionHeader = {
	readonly id: string;
	readonly cwd: string;
};

function isReadonlyArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !isReadonlyArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

async function statIfExists(path: string): Promise<Stats | undefined> {
	try {
		return await stat(path);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return undefined;
		throw error;
	}
}

async function readDirIfExists(path: string): Promise<readonly string[]> {
	try {
		return await readdir(path);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw error;
	}
}

function parseJsonLine(line: string): unknown | undefined {
	try {
		const parsed: unknown = JSON.parse(line);
		return parsed;
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}

function parseHeader(line: string, sessionFile: string): SessionHeader {
	const parsed = parseJsonLine(line);
	if (!isRecord(parsed) || parsed.type !== "session") {
		return { id: basename(sessionFile, ".jsonl"), cwd: "" };
	}

	const id = typeof parsed.id === "string" ? parsed.id : basename(sessionFile, ".jsonl");
	const cwd = typeof parsed.cwd === "string" ? parsed.cwd : "";
	return { id, cwd };
}

function getTextParts(content: readonly unknown[]): readonly string[] {
	const texts: string[] = [];
	for (const part of content) {
		if (!isRecord(part)) continue;
		if (part.type !== "text") continue;
		if (typeof part.text === "string") texts.push(part.text);
	}
	return texts;
}

function isSystemInjectedPrompt(text: string): boolean {
	const trimmedStart = text.trimStart();
	return SYSTEM_PREFIXES.some((prefix) => trimmedStart.startsWith(prefix));
}

function extractUserText(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (isReadonlyArray(content)) return getTextParts(content).join("\n");
	return undefined;
}

function parseMessage(line: string, sessionFile: string, header: SessionHeader): HistoryEntry | undefined {
	const parsed = parseJsonLine(line);
	if (!isRecord(parsed) || parsed.type !== "message") return undefined;

	const message = parsed.message;
	if (!isRecord(message) || message.role !== "user") return undefined;
	const text = extractUserText(message.content);
	if (text === undefined || !text.trim() || isSystemInjectedPrompt(text)) return undefined;

	const rawTimestamp = parsed.timestamp;
	if (typeof rawTimestamp !== "string") return undefined;
	const timestamp = Date.parse(rawTimestamp);
	if (!Number.isFinite(timestamp)) return undefined;

	return { text, sessionId: header.id, sessionFile, cwd: header.cwd, timestamp };
}

function dedupeNewest(entries: readonly HistoryEntry[]): readonly HistoryEntry[] {
	const newestByText = new Map<string, HistoryEntry>();
	for (const entry of entries) {
		const existing = newestByText.get(entry.text);
		if (!existing || entry.timestamp > existing.timestamp) newestByText.set(entry.text, entry);
	}
	return [...newestByText.values()].sort((left, right) => right.timestamp - left.timestamp);
}

async function appendSessionEntries(sessionFile: string, entries: HistoryEntry[]): Promise<void> {
	const text = await readFile(sessionFile, "utf-8");
	const lines = text.split("\n").filter((line) => line.length > 0);
	const headerLine = lines[0];
	if (!headerLine) return;

	const header = parseHeader(headerLine, sessionFile);
	for (let index = lines.length - 1; index >= 1; index--) {
		const line = lines[index];
		if (line === undefined) continue;
		const entry = parseMessage(line, sessionFile, header);
		if (entry) entries.push(entry);
		if (entries.length >= MAX_HISTORY_ENTRIES) return;
	}
}

type DiscoveredSessionFile = {
	readonly path: string;
	readonly basename: string;
};

async function collectJsonlFilesInDir(dir: string): Promise<readonly DiscoveredSessionFile[]> {
	const fileNames = await readDirIfExists(dir);
	const files: DiscoveredSessionFile[] = [];
	for (const fileName of fileNames) {
		if (!fileName.endsWith(".jsonl")) continue;
		const path = join(dir, fileName);
		const fileStat = await statIfExists(path);
		if (!fileStat?.isFile()) continue;
		files.push({ path, basename: fileName });
	}
	return files;
}

async function discoverSessionFiles(rootDir: string): Promise<readonly DiscoveredSessionFile[]> {
	const topLevel = await readDirIfExists(rootDir);
	const all: DiscoveredSessionFile[] = [...(await collectJsonlFilesInDir(rootDir))];
	for (const name of topLevel) {
		if (name.endsWith(".jsonl")) continue;
		const subDir = join(rootDir, name);
		const subStat = await statIfExists(subDir);
		if (!subStat?.isDirectory()) continue;
		all.push(...(await collectJsonlFilesInDir(subDir)));
	}
	all.sort((left, right) => right.basename.localeCompare(left.basename));
	return all;
}

export async function indexSessions(rootDir: string): Promise<readonly HistoryEntry[]> {
	const sessionFiles = await discoverSessionFiles(rootDir);
	const entries: HistoryEntry[] = [];
	for (const file of sessionFiles) {
		await appendSessionEntries(file.path, entries);
		if (entries.length >= MAX_HISTORY_ENTRIES) break;
	}
	return dedupeNewest(entries);
}
