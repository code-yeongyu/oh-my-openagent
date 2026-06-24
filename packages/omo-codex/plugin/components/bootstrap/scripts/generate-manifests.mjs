#!/usr/bin/env node
// Regenerates the committed, reviewed manifest at ../manifests/node.json.
// This script is the ONLY network-touching code in the bootstrap component; runtime
// downloads consume the pinned values, and unit tests inject fetch (never the network).
//
// Re-run procedure to move the pinned Node.js LTS:
//   1. node packages/omo-codex/plugin/components/bootstrap/scripts/generate-manifests.mjs
//      [--node-version <x.y.z>]
//   2. Review the manifest diff and commit it. Manifests are NEVER generated at build
//      time; builds must stay offline and deterministic.
//
// Sources:
//   - node: https://nodejs.org/dist (SHASUMS256.txt per release; win32-x64 zip only)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const componentRoot = dirname(scriptDirectory);
const manifestsDirectory = join(componentRoot, "manifests");

function parseArgs(argv) {
	const flags = {};
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--node-version") flags.nodeVersion = argv[(index += 1)];
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
const nodeVersion = flags.nodeVersion ?? (await resolveLatestNodeLtsVersion());
await writeManifest("node.json", await generateNodeManifest(nodeVersion));
