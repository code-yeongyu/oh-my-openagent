// plan-map.mjs - derive a READ-ONLY wave execution map (Mermaid) from a ulw-plan work plan.
//
// Zero external dependencies (node:fs/path/process/url/crypto/child_process builtins only) so it
// runs byte-identically under `node` and `bun` on macOS, Linux, and Windows - same portability
// contract as ulw-plan's scaffold-plan.mjs.
//
// Usage:  node "<skill-root>/scripts/plan-map.mjs" <plan-file-or-slug> [--html] [--open] [--check] [--stdout] [--out-dir <dir>]
//
// WHAT IT CLAIMS (and nothing more):
// - It parses ONLY the mandated plan grammar (full-workflow.md / scaffold-plan.mjs): column-zero
//   `- [ ] N. <title>` rows in `## Todos` and `- [ ] F<n>. <title>` rows in
//   `## Final verification wave`.
// - Wave grouping ladder, most-canonical first:
//     1. the per-todo `Parallelization: Wave <N>` metadata line the ulw-plan template mandates;
//     2. column-zero `###`(+) headings inside the Todos region (one group per heading);
//     3. neither present -> tasks render as a document-order chain, labeled as such.
//   Tasks inside one group are lanes that may run concurrently; groups are barriers.
// - Edges mean wave barriers / plan DOCUMENT ORDER, never inferred per-task dependencies.
//   No LLM anywhere in the parse/emit path; identical plan bytes + identical source path and
//   options -> identical output bytes.
//
// FAIL-SOFT CONTRACT (exit codes):
//   0 - map generated (warnings, if any, are printed and embedded in the map)
//   1 - unsupported plan structure (missing `## Todos`, or zero rows matching the grammar);
//       a human-fixable diagnostic explains exactly what was looked for
//   2 - usage / IO errors (unknown flag, unreadable input, write-path escape, opener failure)
//
// WRITE BOUNDARY: the plan file is NEVER modified (writing over the source plan is refused even
// via --out-dir). Default output goes under `.omo/maps/`; any output path must resolve inside the
// working directory through real paths (symlinked components are refused, mirroring
// scaffold-plan.mjs's write guards).

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const EXIT_OK = 0;
export const EXIT_UNSUPPORTED = 1;
export const EXIT_USAGE = 2;

const TODOS_SECTION = "todos";
const FINAL_SECTION = "final verification wave";
const TASK_ROW = /^- \[( |x|X)\] (\d+)\.\s+(.*)$/;
const FINAL_ROW = /^- \[( |x|X)\] F(\d+)\.\s+(.*)$/;
const CHECKBOX_LIKE = /^- \[( |x|X)\]\s/;
const PARALLELIZATION_WAVE = /^Parallelization:.*\bWave\s+(\d+)\b/;
const MAX_LABEL_LENGTH = 60;
const READABILITY_WARNING_NODES = 30;
// Exact version pin (verified against the npm registry when this skill was authored); the viewer
// page states this URL and tests assert it is the page's only remote reference.
export const MERMAID_CDN_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.esm.min.mjs";

export class PlanMapError extends Error {
	constructor(kind, message) {
		super(message);
		this.name = "PlanMapError";
		this.kind = kind;
	}
}

function normalizeHeadingText(text) {
	return text.trim().replace(/:$/, "").toLowerCase();
}

// Track fenced code blocks so documentation examples can never be mistaken for
// real sections or task rows. A fence opens with 3+ backticks or tildes at
// column zero (info string allowed) and closes only on a bare column-zero fence
// of the same character, at least the same length, with nothing but trailing
// whitespace after it (CommonMark closing-fence rule).
function createFenceTracker() {
	let fenceChar = null;
	let fenceLength = 0;
	return (line) => {
		const match = /^(`{3,}|~{3,})(.*)$/.exec(line);
		if (match) {
			const char = match[1][0];
			const length = match[1].length;
			const rest = match[2];
			if (fenceChar === null) {
				fenceChar = char;
				fenceLength = length;
				return true;
			}
			if (char === fenceChar && length >= fenceLength && rest.trim() === "") {
				fenceChar = null;
				fenceLength = 0;
				return true;
			}
			return true;
		}
		return fenceChar !== null;
	};
}

function isMandatedTaskNumber(number) {
	return Number.isSafeInteger(number) && number >= 1;
}

// Parse the mandated plan grammar into { title, groups, finals, warnings, taskCount, grouping }.
// Throws PlanMapError("no-todos-section" | "no-tasks") for unsupported structure.
export function parsePlanMap(content) {
	const lines = content.replaceAll("\r\n", "\n").split("\n");
	const insideFence = createFenceTracker();
	const warnings = [];
	let title = null;
	let section = null;
	let sawTodosSection = false;
	const headingGroups = [{ label: null, tasks: [] }];
	const tasks = [];
	const finals = [];
	const seenTaskNumbers = new Map();
	const seenFinalNumbers = new Set();
	let ignoredCheckboxRows = 0;
	let currentTask = null;

	for (const line of lines) {
		if (insideFence(line)) continue;

		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			currentTask = null;
			const level = heading[1].length;
			const text = heading[2].trim();
			if (level === 1 && title === null) {
				title = text;
				continue;
			}
			if (level <= 2) {
				const normalized = normalizeHeadingText(text);
				if (normalized === TODOS_SECTION) {
					section = "todos";
					sawTodosSection = true;
				} else if (normalized === FINAL_SECTION) {
					section = "final";
				} else {
					section = null;
				}
				continue;
			}
			if (section === "todos") {
				headingGroups.push({ label: text, tasks: [] });
			}
			continue;
		}

		if (section === "todos") {
			const row = TASK_ROW.exec(line);
			if (row) {
				currentTask = null;
				const number = Number.parseInt(row[2], 10);
				const taskTitle = row[3].trim();
				if (!isMandatedTaskNumber(number) || taskTitle === "") {
					ignoredCheckboxRows += 1;
					continue;
				}
				const count = (seenTaskNumbers.get(number) ?? 0) + 1;
				seenTaskNumbers.set(number, count);
				if (count > 1) {
					warnings.push(`duplicate task number ${number} - node ids stay unique (T${number}_${count})`);
				}
				currentTask = {
					id: count === 1 ? `T${number}` : `T${number}_${count}`,
					number,
					title: taskTitle,
					done: row[1] !== " ",
					wave: null,
				};
				tasks.push(currentTask);
				headingGroups.at(-1).tasks.push(currentTask);
				continue;
			}
			if (line.startsWith("- ") || /^\S/.test(line)) currentTask = null;
			if (currentTask && /^\s+\S/.test(line)) {
				const waveMatch = PARALLELIZATION_WAVE.exec(line.trim());
				if (waveMatch) {
					const wave = Number.parseInt(waveMatch[1], 10);
					if (isMandatedTaskNumber(wave)) currentTask.wave = wave;
				}
				continue;
			}
			if (CHECKBOX_LIKE.test(line)) {
				ignoredCheckboxRows += 1;
				continue;
			}
			continue;
		}

		if (section === "final") {
			const finalRow = FINAL_ROW.exec(line);
			if (finalRow) {
				const number = Number.parseInt(finalRow[2], 10);
				const finalTitle = finalRow[3].trim();
				if (!isMandatedTaskNumber(number) || finalTitle === "") {
					warnings.push(`final-verifier row outside the mandated grammar ignored: ${line.trim()}`);
					continue;
				}
				if (seenFinalNumbers.has(number)) {
					warnings.push(`duplicate final-verifier number F${number} - later row ignored`);
					continue;
				}
				seenFinalNumbers.add(number);
				finals.push({ id: `F${number}`, number, title: finalTitle, done: finalRow[1] !== " " });
				continue;
			}
			if (TASK_ROW.test(line)) {
				warnings.push(`implementation row found inside ## Final verification wave - ignored: ${line.trim()}`);
			}
		}
	}

	if (!sawTodosSection) {
		throw new PlanMapError(
			"no-todos-section",
			"unsupported plan structure: no `## Todos` section found outside code fences. " +
				"ulw-map reads the plan shape ulw-plan's scaffold emits; point it at a `.omo/plans/<slug>.md` work plan.",
		);
	}
	if (tasks.length === 0) {
		const hint =
			ignoredCheckboxRows > 0
				? `${ignoredCheckboxRows} checkbox row(s) found, but none match the mandated column-zero \`- [ ] N. <title>\` grammar (positive decimal N, non-empty title).`
				: "no checkbox rows found in the `## Todos` section.";
		throw new PlanMapError("no-tasks", `unsupported plan structure: ${hint}`);
	}
	if (ignoredCheckboxRows > 0) {
		warnings.push(
			`${ignoredCheckboxRows} checkbox row(s) in ## Todos ignored - they do not match the \`- [ ] N. <title>\` grammar`,
		);
	}

	// Wave grouping ladder: Parallelization metadata > headings > document order.
	let groups;
	let grouping;
	const withWave = tasks.filter((task) => task.wave !== null);
	if (withWave.length > 0) {
		grouping = "wave-metadata";
		let lastWave = null;
		for (const task of tasks) {
			if (task.wave === null) {
				task.wave = lastWave ?? withWave[0].wave;
				warnings.push(
					`task ${task.number} has no \`Parallelization: Wave <N>\` line - inherited Wave ${task.wave} from document order`,
				);
			}
			lastWave = task.wave;
		}
		const byWave = new Map();
		for (const task of tasks) {
			if (!byWave.has(task.wave)) byWave.set(task.wave, []);
			byWave.get(task.wave).push(task);
		}
		groups = [...byWave.keys()].sort((a, b) => a - b).map((wave) => ({ label: `Wave ${wave}`, tasks: byWave.get(wave) }));
	} else {
		const implicitGroup = headingGroups[0];
		groups = headingGroups.filter((group) => {
			if (group.tasks.length > 0) return true;
			if (group.label !== null) warnings.push(`group heading with no task rows dropped: "${group.label}"`);
			return false;
		});
		const hasExplicitGroups = groups.some((group) => group.label !== null);
		if (hasExplicitGroups && implicitGroup.tasks.length > 0) {
			implicitGroup.label = "(ungrouped)";
			warnings.push('tasks found before the first group heading - grouped as "(ungrouped)"');
		}
		grouping = hasExplicitGroups ? "headings" : "document-order";
	}

	if (tasks.length + finals.length > READABILITY_WARNING_NODES) {
		warnings.push(
			`${tasks.length + finals.length} nodes - large maps render but read poorly; consider reviewing wave by wave`,
		);
	}

	return { title, groups, finals, warnings, taskCount: tasks.length, grouping };
}

// Mermaid label sanitization: node ids are program-generated (injection-safe by
// construction); labels are quoted, stripped of fence/bracket/quote characters,
// and truncated for readability.
export function sanitizeLabel(text) {
	let label = text
		.replaceAll('"', "'")
		.replaceAll("`", "'")
		.replaceAll("[", "(")
		.replaceAll("]", ")")
		.replaceAll("{", "(")
		.replaceAll("}", ")")
		.replaceAll(/\s+/g, " ")
		.trim();
	if (label.length > MAX_LABEL_LENGTH) label = `${label.slice(0, MAX_LABEL_LENGTH - 1)}…`;
	return label;
}

export function buildMermaid(map) {
	const out = [];
	out.push("flowchart TD");
	const flat = map.grouping === "document-order";

	if (flat) {
		const tasks = map.groups[0].tasks;
		for (const task of tasks) {
			out.push(`    ${task.id}["${task.done ? "✓ " : ""}${task.number}. ${sanitizeLabel(task.title)}"]`);
		}
		for (let i = 0; i + 1 < tasks.length; i += 1) {
			out.push(`    ${tasks[i].id} --> ${tasks[i + 1].id}`);
		}
	} else {
		map.groups.forEach((group, index) => {
			const waveId = `W${index + 1}`;
			out.push(`    subgraph ${waveId}["${sanitizeLabel(group.label ?? "Todos")}"]`);
			for (const task of group.tasks) {
				out.push(`        ${task.id}["${task.done ? "✓ " : ""}${task.number}. ${sanitizeLabel(task.title)}"]`);
			}
			out.push("    end");
		});
		for (let i = 0; i + 1 < map.groups.length; i += 1) {
			out.push(`    W${i + 1} --> W${i + 2}`);
		}
	}

	if (map.finals.length > 0) {
		const sourceId = flat ? map.groups[0].tasks.at(-1).id : `W${map.groups.length}`;
		for (const final of map.finals) {
			out.push(`    ${final.id}["${final.done ? "✓ " : ""}F${final.number}. ${sanitizeLabel(final.title)}"]`);
		}
		for (const final of map.finals) {
			out.push(`    ${sourceId} --> ${final.id}`);
		}
		out.push('    FIN(["All approve → complete"])');
		for (const final of map.finals) {
			out.push(`    ${final.id} --> FIN`);
		}
	}

	const doneIds = [...map.groups.flatMap((group) => group.tasks), ...map.finals]
		.filter((node) => node.done)
		.map((node) => node.id);
	out.push("    classDef done fill:#14532d,stroke:#22c55e,color:#ffffff");
	if (doneIds.length > 0) out.push(`    class ${doneIds.join(",")} done`);

	return `${out.join("\n")}\n`;
}

export function planHash(content) {
	return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
}

const GROUPING_NOTES = {
	"wave-metadata": "Wave groups come from the plan's own `Parallelization: Wave <N>` metadata lines.",
	headings: "Wave groups come from headings inside `## Todos` (no `Parallelization: Wave <N>` metadata found).",
	"document-order": "No wave metadata or headings found - tasks are shown in plan document order.",
};

export function buildMapMarkdown(map, mermaid, meta) {
	const doneCount = map.groups.reduce((sum, group) => sum + group.tasks.filter((task) => task.done).length, 0);
	const lines = [];
	lines.push(`# Plan map: ${map.title ?? meta.slug}`);
	lines.push("");
	lines.push(
		`> Derived READ-ONLY from \`${meta.sourceRelPath}\` (sha256 \`${meta.hash}\`) - no LLM in the loop; regenerate with \`$ulw-map\` after the plan changes.`,
	);
	lines.push("");
	lines.push(
		`${map.taskCount} task(s), ${doneCount} done · ${map.groups.length} wave group(s) · ${map.finals.length} final verifier(s)`,
	);
	lines.push("");
	lines.push("```mermaid");
	lines.push(mermaid.trimEnd());
	lines.push("```");
	lines.push("");
	lines.push("## How to read this map");
	lines.push("");
	lines.push(`- ${GROUPING_NOTES[map.grouping]}`);
	lines.push("- Arrows show **wave barriers in plan document order**, not inferred per-task dependencies.");
	lines.push("- Tasks inside one wave group are lanes that may run concurrently; groups run in order.");
	lines.push("- The final verification wave runs in parallel and **all** verifiers must approve.");
	lines.push("- `✓` marks checkboxes already checked off in the plan.");
	if (map.warnings.length > 0) {
		lines.push("");
		lines.push("## Diagnostics");
		lines.push("");
		for (const warning of map.warnings) lines.push(`- ${warning}`);
	}
	lines.push("");
	return lines.join("\n");
}

function escapeHtml(text) {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// Self-written viewer page: the Mermaid SOURCE is the content (always visible as
// text if rendering is unavailable); the renderer loads from an exact-version CDN
// URL at view time - nothing is vendored into the repository.
export function buildMapHtml(map, mermaid, meta) {
	const title = escapeHtml(map.title ?? meta.slug);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan map: ${title}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 2rem auto; max-width: 960px; padding: 0 1rem; background: #0b1020; color: #e5e7eb; }
  h1 { font-size: 1.3rem; }
  .meta { color: #9ca3af; font-size: 0.85rem; }
  .legend { color: #9ca3af; font-size: 0.85rem; border-top: 1px solid #1f2937; margin-top: 1.5rem; padding-top: 0.75rem; }
  pre.mermaid { background: #111827; border-radius: 8px; padding: 1rem; overflow-x: auto; }
  #fallback-note { display: none; color: #fbbf24; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Plan map: ${title}</h1>
<p class="meta">Derived read-only from <code>${escapeHtml(meta.sourceRelPath)}</code> (sha256 <code>${escapeHtml(meta.hash)}</code>) - no LLM in the loop.</p>
<p id="fallback-note">Diagram renderer unavailable (offline?) - the Mermaid source below IS the map.</p>
<pre class="mermaid">${escapeHtml(mermaid.trimEnd())}</pre>
<p class="legend">Arrows = wave barriers in plan document order, not inferred dependencies. Lanes inside a wave may run concurrently. Final verification runs in parallel; all must approve. ✓ = already checked off.</p>
<script type="module">
  try {
    const { default: mermaidLib } = await import("${MERMAID_CDN_URL}");
    mermaidLib.initialize({ startOnLoad: true, theme: "dark", securityLevel: "strict" });
  } catch {
    document.getElementById("fallback-note").style.display = "block";
  }
</script>
</body>
</html>
`;
}

function assertContainedPath(parent, child, message) {
	const rel = relative(parent, child);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new PlanMapError("path-escape", message);
	}
}

// Mirrors scaffold-plan.mjs's write guards: create directories one component at a
// time refusing symlinks, then re-check containment through real paths.
async function mkdirWithoutSymlinks(dir, stopAt) {
	if (dir === stopAt) return;
	const parent = dirname(dir);
	if (parent === dir || relative(stopAt, dir).startsWith("..") || isAbsolute(relative(stopAt, dir))) {
		throw new PlanMapError("path-escape", `refused: output path escapes the working directory: ${dir}`);
	}
	await mkdirWithoutSymlinks(parent, stopAt);
	const stat = await lstat(dir).catch((err) => {
		if (err && err.code === "ENOENT") return null;
		throw err;
	});
	if (stat) {
		if (stat.isSymbolicLink()) {
			throw new PlanMapError("path-escape", `refused: output path component is a symlink: ${dir}`);
		}
		if (!stat.isDirectory()) {
			throw new PlanMapError("path-escape", `refused: output path component is not a directory: ${dir}`);
		}
		return;
	}
	await mkdir(dir);
}

async function prepareOutputRoot(cwd, outRoot) {
	const workspaceRoot = resolve(cwd);
	assertContainedPath(workspaceRoot, outRoot, `refused: --out-dir escapes the working directory: ${outRoot}`);
	await mkdirWithoutSymlinks(outRoot, workspaceRoot);
	const workspaceReal = await realpath(workspaceRoot);
	const outReal = await realpath(outRoot);
	assertContainedPath(
		workspaceReal,
		outReal,
		`refused: --out-dir escapes the working directory through symlinks: ${outRoot}`,
	);
}

async function assertSafeWriteTarget(target, planReal) {
	const stat = await lstat(target).catch((err) => {
		if (err && err.code === "ENOENT") return null;
		throw err;
	});
	if (stat?.isSymbolicLink()) {
		throw new PlanMapError("path-escape", `refused: output target is a symlink: ${target}`);
	}
	if (stat) {
		const targetReal = await realpath(target);
		if (targetReal === planReal) {
			throw new PlanMapError(
				"source-overwrite",
				`refused: output path resolves to the source plan itself (${target}) - ulw-map never modifies the plan`,
			);
		}
	}
}

export function parseArgs(argv) {
	const rest = argv.slice(2);
	let input;
	let html = false;
	let open = false;
	let check = false;
	let stdout = false;
	let outDir;
	for (let i = 0; i < rest.length; i += 1) {
		const arg = rest[i];
		if (arg === "--html") html = true;
		else if (arg === "--open") {
			open = true;
			html = true;
		} else if (arg === "--check") check = true;
		else if (arg === "--stdout") stdout = true;
		else if (arg === "--out-dir") {
			outDir = rest[i + 1];
			if (outDir === undefined || outDir.startsWith("--")) {
				throw new PlanMapError("usage", "--out-dir requires a directory argument");
			}
			i += 1;
		} else if (arg.startsWith("--")) throw new PlanMapError("usage", `unknown flag: ${arg}`);
		else if (input === undefined) input = arg;
		else throw new PlanMapError("usage", `unexpected argument: ${arg}`);
	}
	if (!input) {
		throw new PlanMapError(
			"usage",
			"usage: plan-map.mjs <plan-file-or-slug> [--html] [--open] [--check] [--stdout] [--out-dir <dir>]",
		);
	}
	return { input, html, open, check, stdout, outDir };
}

function resolvePlanPath(cwd, input) {
	const direct = resolve(cwd, input);
	if (existsSync(direct)) return direct;
	const bySlug = join(cwd, ".omo", "plans", `${input}.md`);
	if (existsSync(bySlug)) return bySlug;
	throw new PlanMapError("usage", `plan not found - tried: ${direct} and ${bySlug}`);
}

// Resolves once the opener process actually spawned; rejects if the platform
// opener is unavailable so "opened nothing" can never report success.
function openInBrowser(filePath) {
	const [command, args] =
		process.platform === "darwin"
			? ["open", [filePath]]
			: process.platform === "win32"
				? ["explorer.exe", [filePath]]
				: ["xdg-open", [filePath]];
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, { stdio: "ignore", detached: true });
		child.once("error", (error) => {
			rejectPromise(new PlanMapError("open-failed", `files were written, but opening the browser failed: ${error.message}`));
		});
		child.once("spawn", () => {
			child.unref();
			resolvePromise();
		});
	});
}

export async function runCli(argv, cwd) {
	const options = parseArgs(argv);
	const planPath = resolvePlanPath(cwd, options.input);
	const content = await readFile(planPath, "utf8");
	const map = parsePlanMap(content);
	const slug = basename(planPath).replace(/\.md$/i, "");
	const hash = planHash(content);
	const sourceRelPath = relative(cwd, planPath) || planPath;
	const mermaid = buildMermaid(map);
	const meta = { slug, hash, sourceRelPath: sourceRelPath.replaceAll("\\", "/") };
	const markdown = buildMapMarkdown(map, mermaid, meta);

	for (const warning of map.warnings) console.warn(`warning: ${warning}`);

	if (options.stdout) {
		process.stdout.write(markdown);
		return EXIT_OK;
	}

	const outRoot = options.outDir ? resolve(cwd, options.outDir) : join(cwd, ".omo", "maps");
	const mdPath = join(outRoot, `${slug}.md`);
	const htmlPath = join(outRoot, `${slug}.html`);

	if (options.check) {
		console.log(
			`plan-map --check: ${slug} - ${map.taskCount} task(s), ${map.groups.length} group(s), ${map.finals.length} final(s); would write ${mdPath}${options.html ? ` and ${htmlPath}` : ""}`,
		);
		return EXIT_OK;
	}

	await prepareOutputRoot(cwd, outRoot);
	const planReal = await realpath(planPath);
	await assertSafeWriteTarget(mdPath, planReal);
	await writeFile(mdPath, markdown, "utf8");
	const written = [mdPath];
	if (options.html) {
		await assertSafeWriteTarget(htmlPath, planReal);
		await writeFile(htmlPath, buildMapHtml(map, mermaid, meta), "utf8");
		written.push(htmlPath);
	}
	console.log(
		`plan-map: ${slug} - ${map.taskCount} task(s), ${map.groups.length} group(s), ${map.finals.length} final(s) → ${written.join(", ")}`,
	);
	if (options.open) await openInBrowser(htmlPath);
	return EXIT_OK;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	// process.exitCode (not process.exit) so stdout fully drains before termination.
	runCli(process.argv, process.cwd()).then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			if (error instanceof PlanMapError) {
				console.error(`plan-map: ${error.message}`);
				process.exitCode = error.kind === "no-todos-section" || error.kind === "no-tasks" ? EXIT_UNSUPPORTED : EXIT_USAGE;
				return;
			}
			console.error(`plan-map: unexpected error: ${error?.message ?? error}`);
			process.exitCode = EXIT_USAGE;
		},
	);
}
