import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isCliEntry } from "./entry-guard.mjs";

const pluginScriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pluginScriptsDir, "..", "..", "..", "..");
const sharedSkillsRoot = join(repoRoot, "packages", "shared-skills");
const sharedSkillsScripts = join(sharedSkillsRoot, "scripts");
const materializeScript = join(sharedSkillsScripts, "materialize-frontend-refs.mjs");
const stageOmowrightScript = join(sharedSkillsRoot, "stage-omowright-runtime.mjs");

const upstreamPaths = [
	"packages/shared-skills/upstreams/open-design",
	"packages/shared-skills/upstreams/taste-skill",
	"packages/shared-skills/upstreams/ui-ux-pro-max",
	"packages/shared-skills/upstreams/designpowers",
];

function describePinnedSubmodules() {
	const pins = new Map();
	try {
		// The index is the source of the gitlinks used by submodule update, not a
		// remote branch or the (possibly missing) submodule working directory.
		const entries = execFileSync("git", ["ls-files", "--stage", "-z", "--", ...upstreamPaths], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		for (const entry of entries.split("\0")) {
			const match = /^160000 ([0-9a-f]{40,64}) 0\t(.+)$/.exec(entry);
			if (match) pins.set(match[2], match[1]);
		}
	} catch {
		// A diagnostic failure must not replace the original fetch error.
	}
	return upstreamPaths.map((path) => `${path}@${pins.get(path) ?? "unknown (pinned SHA unavailable)"}`).join(", ");
}

async function initSubmodules({ strict }) {
	const maxAttempts = 3;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			execFileSync("git", ["submodule", "update", "--init", "--recursive", ...upstreamPaths], {
				cwd: repoRoot,
				stdio: "inherit",
				windowsHide: true,
			});
			return true;
		} catch (error) {
			if (attempt < maxAttempts) {
				const delayMs = 1000 * 2 ** (attempt - 1);
				process.stderr.write(`[materialize-shared-upstreams] git submodule init failed (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms\n`);
				await sleep(delayMs);
				continue;
			}
			const message = `[materialize-shared-upstreams] git submodule init failed after ${maxAttempts} attempts: ${error instanceof Error ? error.message : String(error)}; pinned submodules: ${describePinnedSubmodules()}`;
			if (strict) throw new Error(message, { cause: error });
			process.stderr.write(`${message} - continuing without submodule refresh\n`);
			return false;
		}
	}
}

export async function materializeSharedUpstreams({ strict }) {
	await initSubmodules({ strict });
	const { materializeFrontendRefs } = await import(pathToFileURL(materializeScript).href);
	const result = await materializeFrontendRefs({ strict });
	const { stageOmowrightRuntime } = await import(pathToFileURL(stageOmowrightScript).href);
	const omowright = await stageOmowrightRuntime();
	process.stdout.write(`[materialize] staged omowright ${omowright.version} into the browser skill\n`);
	return result;
}

if (isCliEntry(import.meta.url)) {
	// The root build materializes once up front and sets this so downstream codex-plugin
	// builds in the same run do not re-run it; concurrent runs would contend on git's
	// submodule index.lock and race writes into packages/shared-skills/skills.
	if (process.env.OMO_SKIP_MATERIALIZE === "1") {
		process.stdout.write("[materialize] skipped (OMO_SKIP_MATERIALIZE=1)\n");
	} else {
		const strict = process.env.OMO_MATERIALIZE_STRICT === "1" || process.argv.includes("--strict");
		const result = await materializeSharedUpstreams({ strict });
		if (result.skipped && strict) process.exit(1);
	}
}
