import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// ulw-map is a shared skill (single source; sync-skills copies it into the plugin at build time),
// so the contract tests import the shared source directly.
const scriptPath = join(root, "..", "..", "shared-skills", "skills", "ulw-map", "scripts", "plan-map.mjs");
const scriptUrl = pathToFileURL(scriptPath).href;

async function withTempDir(run) {
	const dir = await mkdtemp(join(tmpdir(), "plan-map-"));
	try {
		return await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const CANONICAL_PLAN = `# canonical - Work Plan

## TL;DR (For humans)

What you'll get.

## Todos

- [x] 1. Build the parser
  What to do / Must NOT do: parse only the mandated grammar
  Parallelization: Wave 1 | Blocked by: - | Blocks: 3
  Acceptance criteria (agent-executable): node --test passes
- [ ] 2. Add fixtures
  Parallelization: Wave 1 | Blocked by: - | Blocks: 3
- [ ] 3. Emit mermaid
  Parallelization: Wave 2 | Blocked by: 1, 2 | Blocks: -

## Final verification wave

- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
`;

const HEADING_PLAN = `# demo - Work Plan

## Todos

### Wave 1 - parser

- [x] 1. Build the parser
- [ ] 2. Add fixtures

### Wave 2 - emitter

- [ ] 3. Emit mermaid

## Final verification wave

- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
`;

const FLAT_PLAN = `# flat - Work Plan

## Todos

- [ ] 1. First step
- [ ] 2. Second step
- [x] 3. Third step
`;

test("#given a canonical plan with Parallelization metadata #when parsed #then waves come from the metadata, not headings or order", async () => {
	// given
	const { parsePlanMap } = await import(scriptUrl);
	// when
	const map = parsePlanMap(CANONICAL_PLAN);
	// then
	assert.equal(map.grouping, "wave-metadata");
	assert.deepEqual(
		map.groups.map((group) => [group.label, group.tasks.map((task) => task.id)]),
		[
			["Wave 1", ["T1", "T2"]],
			["Wave 2", ["T3"]],
		],
	);
	assert.equal(map.groups[0].tasks[0].done, true);
	assert.deepEqual(
		map.finals.map((final) => final.id),
		["F1", "F2"],
	);
});

test("#given a task without a Parallelization line among tasks that have one #when parsed #then it inherits the previous wave with a diagnostic", async () => {
	// given
	const { parsePlanMap } = await import(scriptUrl);
	const plan = `# partial - Work Plan

## Todos

- [ ] 1. Has metadata
  Parallelization: Wave 1 | Blocked by: - | Blocks: -
- [ ] 2. No metadata line here
- [ ] 3. Later wave
  Parallelization: Wave 2 | Blocked by: - | Blocks: -
`;
	// when
	const map = parsePlanMap(plan);
	// then
	assert.equal(map.grouping, "wave-metadata");
	assert.deepEqual(
		map.groups.map((group) => [group.label, group.tasks.map((task) => task.number)]),
		[
			["Wave 1", [1, 2]],
			["Wave 2", [3]],
		],
	);
	assert.ok(map.warnings.some((warning) => warning.includes("task 2 has no `Parallelization: Wave <N>` line")));
});

test("#given a heading-grouped plan without metadata #when parsed #then headings group the waves (ladder rung 2)", async () => {
	// given
	const { parsePlanMap, buildMermaid } = await import(scriptUrl);
	// when
	const map = parsePlanMap(HEADING_PLAN);
	const mermaid = buildMermaid(map);
	// then
	assert.equal(map.grouping, "headings");
	assert.ok(mermaid.includes('subgraph W1["Wave 1 - parser"]'));
	assert.ok(mermaid.includes("W1 --> W2"));
	assert.ok(mermaid.includes("W2 --> F1"));
	assert.ok(mermaid.includes("F1 --> FIN"));
	assert.ok(mermaid.includes('T1["✓ 1. Build the parser"]'));
	assert.ok(mermaid.includes("class T1 done"));
});

test("#given a flat plan without metadata or headings #when rendered #then tasks chain in document order (ladder rung 3)", async () => {
	// given
	const { parsePlanMap, buildMermaid, buildMapMarkdown } = await import(scriptUrl);
	// when
	const map = parsePlanMap(FLAT_PLAN);
	const mermaid = buildMermaid(map);
	// then
	assert.equal(map.grouping, "document-order");
	assert.ok(!mermaid.includes("subgraph"));
	assert.ok(mermaid.includes("T1 --> T2"));
	assert.ok(mermaid.includes("T2 --> T3"));
	assert.ok(mermaid.includes("class T3 done"));
	assert.ok(
		buildMapMarkdown(map, mermaid, { slug: "flat", hash: "x", sourceRelPath: "p.md" }).includes(
			"shown in plan document order",
		),
	);
});

test("#given headings and task rows inside code fences #when parsed #then fenced content is ignored", async () => {
	// given
	const { parsePlanMap } = await import(scriptUrl);
	const plan = `# fenced - Work Plan

## Todos

- [ ] 1. Real task

\`\`\`markdown
## Todos

- [ ] 99. Fake task inside a fence
### Fake wave
\`\`\`
`;
	// when
	const map = parsePlanMap(plan);
	// then
	assert.equal(map.taskCount, 1);
	assert.deepEqual(map.groups[0].tasks[0].id, "T1");
});

test("#given a fence line with an info string inside an open fence #when parsed #then it does NOT close the fence (CommonMark closing rule)", async () => {
	// given
	const { parsePlanMap } = await import(scriptUrl);
	const plan = `# pseudo - Work Plan

## Todos

- [ ] 1. Real task

\`\`\`markdown
\`\`\`js
- [ ] 88. Still fenced - a closing fence has no info string
\`\`\`
`;
	// when
	const map = parsePlanMap(plan);
	// then
	assert.equal(map.taskCount, 1);
});

test("#given a document without a Todos section #when parsed #then it fails closed with a fixable diagnostic", async () => {
	// given
	const { parsePlanMap, PlanMapError } = await import(scriptUrl);
	// when / then
	assert.throws(
		() => parsePlanMap("# not a plan\n\njust prose\n"),
		(error) => error instanceof PlanMapError && error.kind === "no-todos-section",
	);
});

test("#given checkbox rows that do not match the mandated grammar #when parsed #then it fails closed and counts the ignored rows", async () => {
	// given
	const { parsePlanMap, PlanMapError } = await import(scriptUrl);
	const plan = `# loose - Work Plan

## Todos

- [ ] unnumbered todo
- [ ] 0. zero is not a positive task number
`;
	// when / then
	assert.throws(
		() => parsePlanMap(plan),
		(error) =>
			error instanceof PlanMapError && error.kind === "no-tasks" && error.message.includes("2 checkbox row(s)"),
	);
});

test("#given whitespace-only titles and unsafe task numbers #when parsed #then those rows are ignored with a diagnostic", async () => {
	// given
	const { parsePlanMap } = await import(scriptUrl);
	const plan = `# edge - Work Plan

## Todos

- [ ] 1. Real task
- [ ] 2.${"   "}
- [ ] 99999999999999999999. unsafe number
`;
	// when
	const map = parsePlanMap(plan);
	// then
	assert.equal(map.taskCount, 1);
	assert.ok(map.warnings.some((warning) => warning.includes("2 checkbox row(s)")));
});

test("#given duplicate task numbers #when parsed #then node ids stay unique and a warning is recorded", async () => {
	// given
	const { parsePlanMap, buildMermaid } = await import(scriptUrl);
	const plan = `# dup - Work Plan

## Todos

- [ ] 1. First
- [ ] 1. Duplicate number
`;
	// when
	const map = parsePlanMap(plan);
	// then
	assert.deepEqual(
		map.groups[0].tasks.map((task) => task.id),
		["T1", "T1_2"],
	);
	assert.ok(map.warnings.some((warning) => warning.includes("duplicate task number 1")));
	assert.ok(buildMermaid(map).includes("T1_2"));
});

test("#given bracket and quote injection in titles #when mermaid is emitted #then labels are sanitized and ids stay program-generated", async () => {
	// given
	const { parsePlanMap, buildMermaid } = await import(scriptUrl);
	const plan = `# inject - Work Plan

## Todos

- [ ] 1. Break "the] renderer\` with [brackets
`;
	// when
	const mermaid = buildMermaid(parsePlanMap(plan));
	// then
	assert.ok(mermaid.includes(`T1["1. Break 'the) renderer' with (brackets"]`));
	assert.ok(!mermaid.includes("Break \"the]"));
});

test("#given CRLF and LF variants of the same plan #when rendered #then output is identical (parse-level determinism)", async () => {
	// given
	const { parsePlanMap, buildMermaid, buildMapMarkdown, planHash } = await import(scriptUrl);
	const crlf = CANONICAL_PLAN.replaceAll("\n", "\r\n");
	const meta = { slug: "canonical", hash: "x", sourceRelPath: "p.md" };
	// when
	const fromLf = buildMapMarkdown(parsePlanMap(CANONICAL_PLAN), buildMermaid(parsePlanMap(CANONICAL_PLAN)), meta);
	const fromCrlf = buildMapMarkdown(parsePlanMap(crlf), buildMermaid(parsePlanMap(crlf)), meta);
	// then --- hashes differ because the input bytes differ, which the map records honestly
	assert.equal(fromLf, fromCrlf);
	assert.notEqual(planHash(CANONICAL_PLAN), planHash(crlf));
});

test("#given nested (indented) checkboxes under a task #when parsed #then only column-zero rows count", async () => {
	// given
	const { parsePlanMap } = await import(scriptUrl);
	const plan = `# nested - Work Plan

## Todos

- [ ] 1. Real task
  - [ ] acceptance criterion, not a task
  - [ ] 2. also not a task (indented)
`;
	// when
	const map = parsePlanMap(plan);
	// then
	assert.equal(map.taskCount, 1);
});

test("#given a plan without a final verification section #when rendered #then the map has no FIN join", async () => {
	// given
	const { parsePlanMap, buildMermaid } = await import(scriptUrl);
	// when
	const mermaid = buildMermaid(parsePlanMap(FLAT_PLAN));
	// then
	assert.ok(!mermaid.includes("FIN"));
});

test("#given the HTML viewer #when built #then the mermaid source is escaped content and the only remote URL is the exact-version renderer", async () => {
	// given
	const { parsePlanMap, buildMermaid, buildMapHtml, MERMAID_CDN_URL } = await import(scriptUrl);
	const map = parsePlanMap(HEADING_PLAN);
	// when
	const html = buildMapHtml(map, buildMermaid(map), { slug: "demo", hash: "abc", sourceRelPath: "p.md" });
	// then
	assert.ok(html.includes('<pre class="mermaid">'));
	assert.ok(MERMAID_CDN_URL.startsWith("https://cdn.jsdelivr.net/npm/mermaid@11."));
	const remoteUrls = html.match(/https?:\/\/[^"' )]+/g) ?? [];
	assert.deepEqual(
		remoteUrls.filter((url) => url !== MERMAID_CDN_URL),
		[],
	);
	assert.ok(!html.includes('T1["'));
	assert.ok(html.includes("T1[&quot;"));
});

test("#given the CLI in --check mode #when run against a temp plan #then it reports without writing anything", async () => {
	// given
	const { runCli, EXIT_OK } = await import(scriptUrl);
	await withTempDir(async (dir) => {
		const planPath = join(dir, "demo.md");
		await writeFile(planPath, CANONICAL_PLAN, "utf8");
		// when
		const code = await runCli(["node", "plan-map.mjs", planPath, "--check"], dir);
		// then
		assert.equal(code, EXIT_OK);
		assert.deepEqual(await readdir(dir), ["demo.md"]);
	});
});

test("#given the CLI in default mode #when run twice #then it writes under .omo/maps, re-runs are byte-identical, and the source is untouched", async () => {
	// given
	const { runCli } = await import(scriptUrl);
	await withTempDir(async (dir) => {
		const planPath = join(dir, "demo.md");
		await writeFile(planPath, CANONICAL_PLAN, "utf8");
		// when
		await runCli(["node", "plan-map.mjs", planPath, "--html"], dir);
		const mdPath = join(dir, ".omo", "maps", "demo.md");
		const first = await readFile(mdPath, "utf8");
		await runCli(["node", "plan-map.mjs", planPath, "--html"], dir);
		const second = await readFile(mdPath, "utf8");
		// then
		assert.equal(first, second);
		assert.ok(first.endsWith("\n"));
		assert.ok((await readFile(join(dir, ".omo", "maps", "demo.html"), "utf8")).includes("Plan map"));
		assert.equal(await readFile(planPath, "utf8"), CANONICAL_PLAN);
	});
});

test("#given --out-dir pointing at the plan's own directory #when run #then overwriting the source plan is refused", async () => {
	// given
	const { runCli, PlanMapError } = await import(scriptUrl);
	await withTempDir(async (dir) => {
		const planPath = join(dir, "demo.md");
		await writeFile(planPath, CANONICAL_PLAN, "utf8");
		// when / then
		await assert.rejects(
			() => runCli(["node", "plan-map.mjs", planPath, "--out-dir", "."], dir),
			(error) => error instanceof PlanMapError && error.kind === "source-overwrite",
		);
		// and --- the plan survived
		assert.equal(await readFile(planPath, "utf8"), CANONICAL_PLAN);
	});
});

test("#given an --out-dir that escapes the working directory #when run #then it refuses", async () => {
	// given
	const { runCli, PlanMapError } = await import(scriptUrl);
	await withTempDir(async (dir) => {
		await writeFile(join(dir, "demo.md"), CANONICAL_PLAN, "utf8");
		// when / then
		await assert.rejects(
			() => runCli(["node", "plan-map.mjs", join(dir, "demo.md"), "--out-dir", ".."], dir),
			(error) => error instanceof PlanMapError && error.kind === "path-escape",
		);
	});
});

test("#given an --out-dir routed through a symlink to outside #when run #then the symlinked component is refused", async () => {
	// given
	const { runCli, PlanMapError } = await import(scriptUrl);
	await withTempDir(async (outside) => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "demo.md"), CANONICAL_PLAN, "utf8");
			await symlink(outside, join(dir, "leak"), "dir");
			// when / then
			await assert.rejects(
				() => runCli(["node", "plan-map.mjs", join(dir, "demo.md"), "--out-dir", "leak"], dir),
				(error) => error instanceof PlanMapError && error.kind === "path-escape",
			);
			// and --- nothing landed outside the workspace
			assert.deepEqual(await readdir(outside), []);
		});
	});
});

test("#given --out-dir immediately followed by another flag #when parsed #then it is a usage error, not a directory named --check", async () => {
	// given
	const { parseArgs, PlanMapError } = await import(scriptUrl);
	// when / then
	assert.throws(
		() => parseArgs(["node", "plan-map.mjs", "demo.md", "--out-dir", "--check"]),
		(error) => error instanceof PlanMapError && error.kind === "usage",
	);
});

test("#given a slug instead of a path #when the plan lives in .omo/plans #then it resolves by slug", async () => {
	// given
	const { runCli } = await import(scriptUrl);
	await withTempDir(async (dir) => {
		const plansDir = join(dir, ".omo", "plans");
		await mkdir(plansDir, { recursive: true });
		await writeFile(join(plansDir, "demo.md"), CANONICAL_PLAN, "utf8");
		// when
		const code = await runCli(["node", "plan-map.mjs", "demo", "--check"], dir);
		// then
		assert.equal(code, 0);
	});
});

test("#given a fresh scaffold skeleton whose placeholder todo was never filled #when parsed #then the map warns about the template placeholder", async () => {
	// given
	const { parsePlanMap } = await import(scriptUrl);
	const plan = `# fresh - Work Plan

## Todos

- [ ] 1. <title>
  Parallelization: Wave <N> | Blocked by: <...> | Blocks: <...>
`;
	// when
	const map = parsePlanMap(plan);
	// then --- the map still renders, but says the plan may not contain real todos yet
	assert.equal(map.taskCount, 1);
	assert.ok(map.warnings.some((warning) => warning.includes("unfilled template placeholder")));
});
