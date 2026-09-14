import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readLedgerAt } from "./ledger.js";
import { type UlwLoopScope, ulwLoopDir, ulwLoopStateLockPath } from "./paths.js";
import { assertStateLockOwned, migrationEntries } from "./plan-io.js";
import { hasCode, type PlanCommitRecord, readOptional, readRecords, reconcilePlan } from "./plan-log.js";
import { UlwLoopError, type UlwLoopLedgerEntry, type UlwLoopPlan } from "./types.js";

interface CommitHooks {
	readonly beforeMutation?: () => void | Promise<void>;
	readonly beforeCommit?: () => void | Promise<void>;
	readonly afterCommit?: () => void | Promise<void>;
	readonly link?: (source: string, destination: string) => void;
	readonly writeView?: (path: string, content: string) => Promise<void>;
}
const hooks = new AsyncLocalStorage<CommitHooks>();
export function withCommitHooks<T>(value: CommitHooks, fn: () => Promise<T>): Promise<T> {
	return hooks.run(value, fn);
}

export async function beforePlanMutation(): Promise<void> {
	await hooks.getStore()?.beforeMutation?.();
}
export async function writeViewFile(path: string, content: string): Promise<void> {
	await (hooks.getStore()?.writeView ?? writeFile)(path, content);
}

// link is the sole commit point; no copy fallback (Node copyFile is not atomic).
// A resumed zombie can publish first, but never overwrite an existing revision.
// Logical audit order is (revision, sequence), not materialization completion time.
export async function commit(
	repoRoot: string,
	scope: UlwLoopScope | undefined,
	mutation: {
		readonly plan: UlwLoopPlan;
		readonly entries: readonly UlwLoopLedgerEntry[];
	},
): Promise<void> {
	const { plan } = mutation;
	const dir = ulwLoopDir(repoRoot, scope);
	assertStateLockOwned(ulwLoopStateLockPath(repoRoot, scope));
	await hooks.getStore()?.beforeCommit?.();
	const next = (plan.revision ?? 0) + 1;
	const brief = plan.brief ?? readOptional(join(dir, "brief.md")) ?? "";
	const entries = [...migrationEntries(plan), ...mutation.entries].map((entry, seq) => ({
		...entry,
		revision: next,
		id: `${next}-${seq}`,
	}));
	const record: PlanCommitRecord = {
		version: 1,
		revision: next,
		plan: { ...plan, revision: next, brief },
		ledger: entries,
	};
	mkdirSync(join(dir, "revisions"), { recursive: true });
	mkdirSync(join(dir, "tmp"), { recursive: true });
	const temp = join(dir, "tmp", `${process.pid}-${randomUUID()}.json`);
	try {
		writeFileSync(temp, `${JSON.stringify(record)}\n`, { flag: "wx" });
		try {
			(hooks.getStore()?.link ?? linkSync)(temp, join(dir, "revisions", `${String(next).padStart(8, "0")}.json`));
		} catch (error) {
			if (hasCode(error, "EEXIST"))
				throw new UlwLoopError("Another writer published the read revision.", "ULW_LOOP_PUBLISH_CONFLICT", {
					cause: error,
				});
			if (["EPERM", "ENOTSUP", "EXDEV"].some((code) => hasCode(error, code)))
				throw new UlwLoopError(
					"Immutable ulw-loop publication requires atomic hard links.",
					"ULW_LOOP_PUBLISH_UNSUPPORTED_FS",
					{ cause: error },
				);
			throw error;
		}
	} finally {
		rmSync(temp, { force: true });
	}
	plan.revision = next;
	plan.brief = brief;
	for (const [index, entry] of mutation.entries.entries())
		Object.assign(entry, entries[index + entries.length - mutation.entries.length]);
	await hooks.getStore()?.afterCommit?.();
	await materialize(dir);
}

function viewContents(dir: string): [string, string][] {
	const plan = reconcilePlan(dir);
	if (plan === undefined || readRecords(dir).length === 0) return [];
	const ledger = readLedgerAt(dir);
	const views: [string, string][] = [
		["goals.json", `${JSON.stringify(plan, null, 2)}\n`],
		["ledger.jsonl", ledger.length === 0 ? "" : `${ledger.map((entry) => JSON.stringify(entry)).join("\n")}\n`],
		["brief.md", plan.brief ?? readOptional(join(dir, "brief.md")) ?? ""],
	];
	return views.filter(([name, content]) => readOptional(join(dir, name)) !== content);
}
export function materializeSync(dir: string): void {
	for (const [name, content] of viewContents(dir)) {
		mkdirSync(join(dir, "tmp"), { recursive: true });
		const temp = join(dir, "tmp", `${process.pid}-${randomUUID()}-${name}`);
		try {
			writeFileSync(temp, content, { flag: "wx" });
			renameSync(temp, join(dir, name));
		} finally {
			rmSync(temp, { force: true });
		}
	}
}
export async function materialize(dir: string): Promise<void> {
	for (const [name, content] of viewContents(dir)) {
		mkdirSync(join(dir, "tmp"), { recursive: true });
		const temp = join(dir, "tmp", `${process.pid}-${randomUUID()}-${name}`);
		try {
			await writeViewFile(temp, content);
			await rename(temp, join(dir, name));
		} finally {
			rmSync(temp, { force: true });
		}
	}
}
