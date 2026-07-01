import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const attributionPath = join(repoRoot, "packages", "shared-skills", "skills", "frontend", "ATTRIBUTION.md");

const upstreams = [
	{ name: "open-design", path: "packages/shared-skills/upstreams/open-design" },
	{ name: "taste-skill", path: "packages/shared-skills/upstreams/taste-skill" },
	{ name: "ui-ux-pro-max", path: "packages/shared-skills/upstreams/ui-ux-pro-max" },
	{ name: "designpowers", path: "packages/shared-skills/upstreams/designpowers" },
];

function submoduleHead(relPath) {
	return execFileSync("git", ["-C", join(repoRoot, relPath), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function attributionShas(content) {
	return [...content.matchAll(/Pinned upstream commit:\s*([0-9a-f]{40})/g)].map((match) => match[1]);
}

function rewritePins(content, headBySection) {
	let index = 0;
	return content.replace(/Pinned upstream commit:\s*[0-9a-f]{40}/g, () => {
		const sha = headBySection[index];
		index += 1;
		return `Pinned upstream commit: ${sha}`;
	});
}

function check() {
	const content = readFileSync(attributionPath, "utf8");
	const pinned = attributionShas(content);
	const heads = upstreams.map((upstream) => submoduleHead(upstream.path));
	const drifted = upstreams.filter((upstream, position) => pinned[position] !== heads[position]);
	if (drifted.length > 0) {
		for (const upstream of drifted) {
			process.stderr.write(`[update-upstreams] ATTRIBUTION pin drift for ${upstream.name}\n`);
		}
		return 1;
	}
	process.stdout.write("[update-upstreams] all ATTRIBUTION pins match the submodule HEADs\n");
	return 0;
}

function update() {
	for (const upstream of upstreams) {
		execFileSync("git", ["submodule", "update", "--remote", upstream.path], { cwd: repoRoot, stdio: "inherit" });
	}
	const heads = upstreams.map((upstream) => submoduleHead(upstream.path));
	const content = readFileSync(attributionPath, "utf8");
	writeFileSync(attributionPath, rewritePins(content, heads), "utf8");
	process.stdout.write(`[update-upstreams] refreshed ${upstreams.length} pins; review + commit the submodule + ATTRIBUTION changes\n`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const exitCode = process.argv.includes("--check") ? check() : update();
	process.exit(exitCode);
}
