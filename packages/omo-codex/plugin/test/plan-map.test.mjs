import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// ulw-map is a shared skill (single source; sync-skills copies it into the plugin at build time),
// so the contract tests import the shared source directly.
const scriptPath = join(root, "..", "..", "shared-skills", "skills", "ulw-map", "scripts", "plan-map.mjs");
const scriptUrl = pathToFileURL(scriptPath).href;

const GROUPED_PLAN = `# demo - Work Plan

## TL;DR (For humans)

What you'll get.

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

test("#given a grouped plan #when parsed #then waves, statuses, and finals come from the mandated grammar", async () => {
	// given
	const { parsePlanMap } = await import(scriptUrl);
	// when
	const map = parsePlanMap(GROUPED_PLAN);
	// then
	assert.equal(map.title, "demo - Work Plan");
	assert.deepEqual(
		map.groups.map((group) => group.label),
		["Wave 1 - parser", "Wave 2 - emitter"],
	);
	assert.deepEqual(
		map.groups[0].tasks.map((task) => [task.id, task.done]),
		[
			["T1", true],
			["T2", false],
		],
	);
	assert.deepEqual(
		map.finals.map((final) => final.id),
		["F1", "F2"],
	);
});

test("#given a grouped plan #when mermaid is emitted #then subgraphs chain in order and finals fan out to a join", async () => {
	// given
	const { parsePlanMap, buildMermaid } = await import(scriptUrl);
	// when
	const mermaid = buildMermaid(parsePlanMap(GROUPED_PLAN));
	// then
	assert.ok(mermaid.includes('subgraph W1["Wave 1 - parser"]'));
	assert.ok(mermaid.includes("W1 --> W2"));
	assert.ok(mermaid.includes("W2 --> F1"));
	assert.ok(mermaid.includes("W2 --> F2"));
	assert.ok(mermaid.includes("F1 --> FIN"));
	assert.ok(mermaid.includes('T1["✓ 1. Build the parser"]'));
	assert.ok(mermaid.includes("class T1 done"));
});

test("#given a flat plan without wave headings #when mermaid is emitted #then tasks chain in document order without subgraphs", async () => {
	// given
	const { parsePlanMap, buildMermaid } = await import(scriptUrl);
	// when
	const mermaid = buildMermaid(parsePlanMap(FLAT_PLAN));
	// then
	assert.ok(!mermaid.includes("subgraph"));
	assert.ok(mermaid.includes("T1 --> T2"));
	assert.ok(mermaid.includes("T2 --> T3"));
	assert.ok(mermaid.includes("class T3 done"));
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
- [ ] another loose row
`;
	// when / then
	assert.throws(
		() => parsePlanMap(plan),
		(error) =>
			error instanceof PlanMapError && error.kind === "no-tasks" && error.message.includes("2 checkbox row(s)"),
	);
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

test("#given CRLF and LF variants of the same plan #when rendered #then output bytes are identical (determinism)", async () => {
	// given
	const { parsePlanMap, buildMermaid, buildMapMarkdown, planHash } = await import(scriptUrl);
	const crlf = GROUPED_PLAN.replaceAll("\n", "\r\n");
	const meta = { slug: "demo", hash: "x", sourceRelPath: "p.md" };
	// when
	const fromLf = buildMapMarkdown(parsePlanMap(GROUPED_PLAN), buildMermaid(parsePlanMap(GROUPED_PLAN)), meta);
	const fromCrlf = buildMapMarkdown(parsePlanMap(crlf), buildMermaid(parsePlanMap(crlf)), meta);
	// then --- parse-level determinism; hashes differ because the input bytes differ, which the map records honestly
	assert.equal(fromLf, fromCrlf);
	assert.notEqual(planHash(GROUPED_PLAN), planHash(crlf));
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

test("#given the HTML viewer #when built #then the mermaid source is escaped content and the only remote URL is the pinned renderer", async () => {
	// given
	const { parsePlanMap, buildMermaid, buildMapHtml } = await import(scriptUrl);
	const map = parsePlanMap(GROUPED_PLAN);
	// when
	const html = buildMapHtml(map, buildMermaid(map), { slug: "demo", hash: "abc", sourceRelPath: "p.md" });
	// then
	assert.ok(html.includes('<pre class="mermaid">'));
	assert.ok(html.includes("cdn.jsdelivr.net/npm/mermaid@11"));
	const remoteUrls = html.match(/https?:\/\/[^"' )]+/g) ?? [];
	assert.deepEqual(
		remoteUrls.filter((url) => !url.startsWith("https://cdn.jsdelivr.net/npm/mermaid@11")),
		[],
	);
	assert.ok(!html.includes('T1["'));
	assert.ok(html.includes("T1[&quot;"));
});

test("#given the CLI in --check mode #when run against a temp plan #then it reports without writing anything", async () => {
	// given
	const { runCli, EXIT_OK } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "plan-map-"));
	const planPath = join(dir, "demo.md");
	await writeFile(planPath, GROUPED_PLAN, "utf8");
	// when
	const code = await runCli(["node", "plan-map.mjs", planPath, "--check"], dir);
	// then
	assert.equal(code, EXIT_OK);
	assert.deepEqual(await readdir(dir), ["demo.md"]);
});

test("#given the CLI in default mode #when run twice #then it writes under .omo/maps and re-runs are byte-identical", async () => {
	// given
	const { runCli } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "plan-map-"));
	const planPath = join(dir, "demo.md");
	await writeFile(planPath, GROUPED_PLAN, "utf8");
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
	// and --- the source plan was never modified
	assert.equal(await readFile(planPath, "utf8"), GROUPED_PLAN);
});

test("#given an --out-dir that escapes the working directory #when run #then it refuses", async () => {
	// given
	const { runCli, PlanMapError } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "plan-map-"));
	await writeFile(join(dir, "demo.md"), GROUPED_PLAN, "utf8");
	// when / then
	await assert.rejects(
		() => runCli(["node", "plan-map.mjs", join(dir, "demo.md"), "--out-dir", ".."], dir),
		(error) => error instanceof PlanMapError && error.kind === "path-escape",
	);
});

test("#given a slug instead of a path #when the plan lives in .omo/plans #then it resolves by slug", async () => {
	// given
	const { runCli } = await import(scriptUrl);
	const dir = await mkdtemp(join(tmpdir(), "plan-map-"));
	const plansDir = join(dir, ".omo", "plans");
	await import("node:fs/promises").then(({ mkdir }) => mkdir(plansDir, { recursive: true }));
	await writeFile(join(plansDir, "demo.md"), GROUPED_PLAN, "utf8");
	// when
	const code = await runCli(["node", "plan-map.mjs", "demo", "--check"], dir);
	// then
	assert.equal(code, 0);
});
