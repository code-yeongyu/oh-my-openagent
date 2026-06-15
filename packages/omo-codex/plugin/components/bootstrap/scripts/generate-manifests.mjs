#!/usr/bin/env node
// Regenerates the committed, reviewed manifests at ../manifests/{ast-grep,node}.json.
// This script is the ONLY network-touching code in the bootstrap component; runtime
// downloads consume the pinned values, and unit tests inject fetch (never the network).
//
// Re-run procedure (after an @ast-grep/cli bump in packages/ast-grep-mcp/package.json,
// or to move the pinned Node.js LTS):
//   1. bun install (so node_modules/@ast-grep/cli matches the lockfile resolution)
//   2. node packages/omo-codex/plugin/components/bootstrap/scripts/generate-manifests.mjs
//      [--ast-grep-version <x.y.z>] [--node-version <x.y.z>]
//   3. Review the manifest diff and commit it. Manifests are NEVER generated at build
//      time; builds must stay offline and deterministic.
//
// Sources:
//   - sg:   https://github.com/ast-grep/ast-grep/releases (assets downloaded + hashed
//           here because the release publishes no checksum files)
//   - node: https://nodejs.org/dist (SHASUMS256.txt per release; win32-x64 zip only)
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const componentRoot = dirname(scriptDirectory);
const repoRoot = resolve(componentRoot, "..", "..", "..", "..", "..");
const manifestsDirectory = join(componentRoot, "manifests");

const SG_PLATFORM_ASSETS = {
	"darwin-arm64": "app-aarch64-apple-darwin.zip",
	"darwin-x64": "app-x86_64-apple-darwin.zip",
	"linux-x64": "app-x86_64-unknown-linux-gnu.zip",
	"win32-x64": "app-x86_64-pc-windows-msvc.zip",
};

function parseArgs(argv) {
	const flags = {};
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--ast-grep-version") flags.astGrepVersion = argv[(index += 1)];
		else if (argv[index] === "--node-version") flags.nodeVersion = argv[(index += 1)];
		else throw new Error(`unknown argument: ${argv[index]}`);
	}
	return flags;
}

async function fetchOk(url, accept) {
	const headers = { "user-agent": "lazycodex-generate-manifests" };
	if (accept) headers.accept = accept;
	if (process.env.GITHUB_TOKEN && url.startsWith("https://api.github.com/")) {
		headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}
	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
	return response;
}

async function resolveInstalledAstGrepVersion() {
	const declared = JSON.parse(await readFile(join(repoRoot, "packages", "ast-grep-mcp", "package.json"), "utf8"))
		.dependencies["@ast-grep/cli"];
	const installedPackageJsonPath = join(repoRoot, "node_modules", "@ast-grep", "cli", "package.json");
	const installed = JSON.parse(await readFile(installedPackageJsonPath, "utf8")).version;
	console.log(`ast-grep: declared ${declared} in packages/ast-grep-mcp, locked install ${installed}`);
	return installed;
}

async function generateAstGrepManifest(version) {
	const release = await (
		await fetchOk(`https://api.github.com/repos/ast-grep/ast-grep/releases/tags/${version}`, "application/vnd.github+json")
	).json();
	const assetNames = new Set(release.assets.map((asset) => asset.name));
	const platforms = {};
	for (const [platformKey, assetName] of Object.entries(SG_PLATFORM_ASSETS)) {
		if (!assetNames.has(assetName)) {
			throw new Error(`release ${version} has no asset named ${assetName} (have: ${[...assetNames].join(", ")})`);
		}
		const url = `https://github.com/ast-grep/ast-grep/releases/download/${version}/${assetName}`;
		const bytes = Buffer.from(await (await fetchOk(url)).arrayBuffer());
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		platforms[platformKey] = { sha256, url };
		console.log(`ast-grep ${platformKey}: ${assetName} ${bytes.length} bytes sha256=${sha256}`);
	}
	return { name: "ast-grep", platforms, version };
}

async function resolveLatestNodeLtsVersion() {
	const releases = await (await fetchOk("https://nodejs.org/dist/index.json")).json();
	const latestLts = releases.find((release) => release.lts !== false);
	if (latestLts === undefined) throw new Error("nodejs.org/dist/index.json contains no LTS release");
	console.log(`node: latest LTS ${latestLts.version} (${latestLts.lts})`);
	return latestLts.version.replace(/^v/, "");
}

async function generateNodeManifest(version) {
	const zipName = `node-v${version}-win-x64.zip`;
	const shasums = await (await fetchOk(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`)).text();
	const line = shasums.split("\n").find((candidate) => candidate.trim().endsWith(`  ${zipName}`) || candidate.trim().endsWith(` ${zipName}`));
	if (line === undefined) throw new Error(`SHASUMS256.txt for v${version} has no entry for ${zipName}`);
	const sha256 = line.trim().split(/\s+/)[0];
	if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`invalid sha256 parsed for ${zipName}: ${sha256}`);
	const url = `https://nodejs.org/dist/v${version}/${zipName}`;
	console.log(`node win32-x64: ${zipName} sha256=${sha256}`);
	return { name: "node", platforms: { "win32-x64": { sha256, url } }, version };
}

async function writeManifest(fileName, manifest) {
	const path = join(manifestsDirectory, fileName);
	await mkdir(manifestsDirectory, { recursive: true });
	await writeFile(path, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
	console.log(`wrote ${path}`);
}

const flags = parseArgs(process.argv.slice(2));
const astGrepVersion = flags.astGrepVersion ?? (await resolveInstalledAstGrepVersion());
const nodeVersion = flags.nodeVersion ?? (await resolveLatestNodeLtsVersion());
await writeManifest("ast-grep.json", await generateAstGrepManifest(astGrepVersion));
await writeManifest("node.json", await generateNodeManifest(nodeVersion));
