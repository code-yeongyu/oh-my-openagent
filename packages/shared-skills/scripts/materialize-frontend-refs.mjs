import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { frontendSkillRoot, thirdPartyMaterializeMap, upstreamsRoot } from "./frontend-refs-manifest.mjs";

function upstreamPopulated(name) {
	const dir = join(upstreamsRoot, name);
	if (!existsSync(dir)) return false;
	const entries = readdirSync(dir).filter((entry) => entry !== ".git");
	return entries.length > 0;
}

function quoteYamlScalar(value) {
	return JSON.stringify(value);
}

export function normalizeSkillFrontmatter(content) {
	return content.replace(/^description:\s+([^"'\[{\|>][^\r\n]*)$/m, (_match, description) => {
		return `description: ${quoteYamlScalar(description.trim())}`;
	});
}

export function isSkillMarkdownSourcePath(sourcePath) {
	const normalizedPath = sourcePath.replaceAll("\\", "/");
	return normalizedPath === "SKILL.md" || normalizedPath.endsWith("/SKILL.md");
}

function materializedContent(relTarget, sourcePath) {
	const content = readFileSync(sourcePath, "utf8");
	const isDesignpowersSkillReference = relTarget.startsWith("references/designpowers/vendor/skills/")
		&& relTarget.endsWith("/reference.md")
		&& isSkillMarkdownSourcePath(sourcePath);
	if (relTarget.endsWith("/SKILL.md") || isDesignpowersSkillReference) return normalizeSkillFrontmatter(content);
	return content;
}

export function materializeFrontendRefs({ strict = false } = {}) {
	const map = thirdPartyMaterializeMap();
	const requiredUpstreams = new Set(Object.values(map).map((entry) => entry.upstream));

	for (const upstream of requiredUpstreams) {
		if (upstreamPopulated(upstream)) continue;
		const message = `[materialize] upstream submodule not initialized: ${upstream}`;
		if (strict) throw new Error(`${message} (run: git submodule update --init packages/shared-skills/upstreams/${upstream})`);
		process.stderr.write(`${message} - skipping frontend ref materialization\n`);
		return { materialized: 0, skipped: true };
	}

	rmSync(join(frontendSkillRoot, "references", "ui-ux-db"), { recursive: true, force: true });
	rmSync(join(frontendSkillRoot, "references", "designpowers", "vendor"), { recursive: true, force: true });

	let materialized = 0;
	for (const [relTarget, { upstream, source }] of Object.entries(map)) {
		const sourcePath = join(upstreamsRoot, upstream, source);
		if (!existsSync(sourcePath)) {
			throw new Error(`[materialize] missing upstream source: ${upstream}/${source} for ${relTarget}`);
		}
		const targetPath = join(frontendSkillRoot, relTarget);
		mkdirSync(dirname(targetPath), { recursive: true });
		writeFileSync(targetPath, materializedContent(relTarget, sourcePath));
		materialized += 1;
	}

	process.stdout.write(`[materialize] wrote ${materialized} frontend reference files from submodules\n`);
	return { materialized, skipped: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const strict = process.argv.includes("--strict");
	const result = materializeFrontendRefs({ strict });
	if (result.skipped && strict) process.exit(1);
}

export const __scriptPath = fileURLToPath(import.meta.url);
