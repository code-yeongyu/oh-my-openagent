// Run only in an isolated remote test checkout. Each mutant is restored before the next.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function replace(source, before, after) {
	if (source.split(before).length !== 2) throw new Error(`Mutation anchor is not unique: ${before}`);
	return source.replace(before, after);
}
const publication = '(hooks.getStore()?.link ?? linkSync)(temp, join(dir, "revisions", `${String(next).padStart(8, "0")}.json`));';
const logTest = "test/plan-commit-log.test.ts";
const recoveryTest = "test/plan-commit-recovery.test.ts";
const mutations = [
	{ name: "heartbeat-no-refresh", file: "src/state-lock.ts", test: "test/state-lock.test.ts", pattern: "\\(3\\)", change: (s) => replace(s, "holder.record.leaseUntil = clock.now()", "holder.record.leaseUntil ??= clock.now()") },
	{ name: "heartbeat-by-path", file: "src/state-lock.ts", test: "test/state-lock.test.ts", pattern: "\\(2\\)", change: (s) => 'import { writeFileSync } from "node:fs";\n' + replace(s, "writeRecord(holder);\n\t\t\tschedule();", "writeFileSync(lockPath, JSON.stringify(holder.record));\n\t\t\tschedule();") },
	{ name: "rename-over-goals", file: "src/plan-commit.ts", test: logTest, pattern: "B wins write", change: (s) => replace(s, publication, `if (next === 1) { ${publication} } else { writeFileSync(temp, JSON.stringify(record.plan)); renameSync(temp, join(dir, "goals.json")); }`) },
	{ name: "delete-published-record", file: "src/plan-commit.ts", test: logTest, pattern: "B wins write", change: (s) => replace(s, "await materialize(dir);", 'await materialize(dir);\n if (next > 1) rmSync(join(dir, "revisions", `${String(next).padStart(8, "0")}.json`));') },
	{ name: "next-from-directory", file: "src/plan-commit.ts", test: logTest, pattern: "\\(6\\)", change: (s) => replace(s, "const next = (plan.revision ?? 0) + 1;", "const next = Math.max(plan.revision ?? 0, ...readRecords(dir).map((record) => record.revision)) + 1;") },
	{ name: "no-holder-retry", file: "src/plan-io.ts", test: logTest, pattern: "\\(6\\)", change: (s) => replace(s, "if (attempt !== 0) throw error;", "throw error;") },
	{ name: "no-plan-reconciliation", file: "src/plan-log.ts", test: logTest, pattern: "\\(7a\\)", change: (s) => replace(s, "const latest = readNewestRecord(dir);", "const latest = cached === undefined ? readNewestRecord(dir) : undefined;") },
	{ name: "no-ledger-reconciliation", file: "src/ledger.ts", test: logTest, pattern: "\\(7a\\)", change: (s) => replace(s, "for (const record of readRecords(dir))", "for (const record of [])") },
	{ name: "cache-only-existence", file: "src/plan-log.ts", test: recoveryTest, pattern: "\\(7b\\)", change: (s) => replace(s, 'return existsSync(join(dir, "goals.json")) || logNames(dir).length > 0;', 'return existsSync(join(dir, "goals.json"));') },
	{ name: "in-place-ledger-append",  file: "src/plan-commit.ts", test: logTest, pattern: "\\(7c\\)", change: (s) => {
		const start = s.indexOf("export async function materialize(dir:");
		if (start < 0) throw new Error("materializer not found");
		const body = replace(s.slice(start), 'const temp = join(dir, "tmp", `${process.pid}-${randomUUID()}-${name}`);', 'const temp = name === "ledger.jsonl" && readRecords(dir).length > 1 ? join(dir, name) : join(dir, "tmp", `${process.pid}-${randomUUID()}-${name}`);');
		return 'import { appendFile } from "node:fs/promises";\n' + s.slice(0, start) + replace(body, 'await writeViewFile(temp, content);', 'if (name === "ledger.jsonl" && readRecords(dir).length > 1) await (hooks.getStore()?.writeView ?? appendFile)(temp, content); else await writeViewFile(temp, content);');
	} },
	{ name: "brief-before-publication", file: "src/plan-crud.ts", test: recoveryTest, pattern: "\\(9\\)", change: (s) => replace(replace(s, 'import { beforePlanMutation, commit }', 'import { beforePlanMutation, commit, writeViewFile }'), "await beforePlanMutation();", 'await beforePlanMutation();\n await writeViewFile(`${repoRoot}/${plan.briefPath}`, plan.brief ?? "");') },
	{ name: "steering-audit-outside-record", file: "src/steering.ts", test: logTest, pattern: "\\(11\\)", change: (s) => replace(s, "await commit(repoRoot, scope, { plan: next, entries });", 'await commit(repoRoot, scope, { plan: next, entries: [] });\n await (await import("node:fs/promises")).appendFile(`${repoRoot}/${next.ledgerPath}`, entries.map((entry) => JSON.stringify(entry)).join("\\n") + "\\n");') },
	{ name: "copy-fallback", file: "src/plan-commit.ts", test: logTest, pattern: "\\(12\\)", change: (s) => 'import { copyFileSync } from "node:fs";\n' + replace(s, publication, `try { ${publication} } catch (error) { if (hasCode(error, "EPERM")) copyFileSync(temp, join(dir, "revisions", \`\${String(next).padStart(8, "0")}.json\`)); else throw error; }`) },
];
const digest = (content) => createHash("sha256").update(content).digest("hex");
let failures = 0;
for (const mutation of mutations) {
	const original = readFileSync(mutation.file, "utf8");
	console.log(`\n## MUTATION ${mutation.name}\nfile=${mutation.file}\nbefore_sha256=${digest(original)}`);
	try {
		writeFileSync(mutation.file, mutation.change(original));
		const args = ["run", "test", "--", mutation.test, "-t", mutation.pattern];
		console.log(`command=bun ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
		const result = spawnSync("bun", args, { encoding: "utf8", timeout: 60_000 });
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
		console.log(output);
		console.log(`mutation_exit=${result.status}`);
		if (result.status !== 1 || !/[1-9]\d* failed/.test(output.replace(/\x1b\[[0-9;]*m/g, "")) || !output.includes("AssertionError")) {
			failures += 1;
			console.log(`PROOF=FAILED ${mutation.name}`);
		} else console.log(`PROOF=RED ${mutation.name}`);
	} finally {
		writeFileSync(mutation.file, original);
		const restored = readFileSync(mutation.file, "utf8");
		if (restored !== original) throw new Error(`Failed to restore ${mutation.file}`);
		console.log(`restored_sha256=${digest(restored)} cleanup=RESTORED`);
	}
}
console.log(`mutation_proofs=${mutations.length} failed_proofs=${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
