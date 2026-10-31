import { lstatSync } from "node:fs";
import { join, parse, relative, resolve, sep } from "node:path";
import type { HookFileSystem, SubagentStopInput } from "./types.js";

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readObject(file: string, fs: HookFileSystem): RecordValue {
	const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
	if (!record(value)) throw Error("Invalid receipt binding");
	return value;
}
function noLinks(file: string, fs: HookFileSystem): void {
	const absolute = resolve(file);
	let current = parse(absolute).root;
	for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
		current = join(current, part);
		if (fs.existsSync(current) && (fs.lstatSync?.(current) ?? lstatSync(current)).isSymbolicLink?.())
			throw Error("Receipt path symlink");
	}
}

/** Only a native parent attachment can extend the default receipt location. */
export function scopedReceipt(input: SubagentStopInput, fs: HookFileSystem, bindingsRoot: string): string | null {
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.agent_id)) return null;
	const bindingFile = join(bindingsRoot, input.agent_id + ".json");
	if (!fs.existsSync(bindingFile)) return null;
	noLinks(bindingFile, fs);
	const binding = readObject(bindingFile, fs);
	if (binding["receiptGrant"] === undefined) return null;
	const grant = binding["receiptGrant"];
	if (!record(grant) || typeof binding["file"] !== "string") throw Error("Invalid receipt grant");
	noLinks(binding["file"], fs);
	const run = readObject(binding["file"], fs);
	const tasks = run["tasks"];
	if (!Array.isArray(tasks)) throw Error("Missing bound tasks");
	const task = tasks.find((value: unknown) => record(value) && value["id"] === binding["taskId"]);
	if (
		!record(task) ||
		run["schemaVersion"] !== 1 ||
		run["workspace"] !== resolve(input.cwd) ||
		typeof run["runId"] !== "string" ||
		!/^[A-Za-z0-9_-]+$/.test(run["runId"]) ||
		resolve(binding["file"]) !== join(input.cwd, ".omo", "operations", run["runId"], "run.json") ||
		task["agentId"] !== input.agent_id ||
		task["role"] !== input.agent_type ||
		task["status"] !== "running"
	)
		throw Error("Receipt identity mismatch");
	for (const key of ["receiptPath", "role", "sourceFingerprint", "spawnCallId"]) {
		if (typeof grant[key] !== "string" || !grant[key] || grant[key] !== task[key])
			throw Error("Receipt grant changed");
	}
	const receiptPath = grant["receiptPath"];
	const prefix = `.omo/operations/${run["runId"]}/`;
	if (
		typeof receiptPath !== "string" ||
		!receiptPath.startsWith(prefix) ||
		receiptPath === prefix + "run.json" ||
		receiptPath.includes("\\") ||
		!receiptPath.split("/").every((part) => part && part !== "." && part !== "..")
	)
		throw Error("Unsafe receipt path");
	const receipts = run["hookReceipts"];
	if (
		!Array.isArray(receipts) ||
		!receipts.some(
			(value: unknown) => record(value) && value["event"] === "PostToolUse" && value["agentId"] === input.agent_id,
		)
	)
		throw Error("Missing native attachment");
	const file = resolve(input.cwd, receiptPath);
	noLinks(file, fs);
	return file;
}
