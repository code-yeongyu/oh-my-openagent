import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isCliEntry } from "./entry-guard.mjs";

const pluginScriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pluginScriptsDir, "..", "..", "..", "..");
const sharedSkillsScripts = join(repoRoot, "packages", "shared-skills", "scripts");
const materializeScript = join(sharedSkillsScripts, "materialize-frontend-refs.mjs");

const upstreamPaths = [
	"packages/shared-skills/upstreams/open-design",
	"packages/shared-skills/upstreams/taste-skill",
	"packages/shared-skills/upstreams/ui-ux-pro-max",
	"packages/shared-skills/upstreams/designpowers",
];

function initSubmodules({ strict }) {
	try {
		execFileSync("git", ["submodule", "update", "--init", "--recursive", ...upstreamPaths], {
			cwd: repoRoot,
			stdio: "inherit",
		});
		return true;
	} catch (error) {
		const message = `[materialize-shared-upstreams] git submodule init failed: ${error instanceof Error ? error.message : String(error)}`;
		if (strict) throw new Error(message);
		process.stderr.write(`${message} - continuing without submodule refresh\n`);
		return false;
	}
}

export async function materializeSharedUpstreams({ strict }) {
	initSubmodules({ strict });
	const { materializeFrontendRefs } = await import(pathToFileURL(materializeScript).href);
	return materializeFrontendRefs({ strict });
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
