import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const skillRel = "packages/shared-skills/skills/ultimate-browsing";

const attributionPath = process.env.ULTIMATE_BROWSING_ATTRIBUTION_OVERRIDE
	?? join(repoRoot, skillRel, "ATTRIBUTION.md");
const chromeStealthPath = process.env.ULTIMATE_BROWSING_CHROME_STEALTH_OVERRIDE
	?? join(repoRoot, skillRel, "references", "chrome-stealth.md");
const templatesManifestPath = process.env.ULTIMATE_BROWSING_TEMPLATES_OVERRIDE
	?? join(repoRoot, skillRel, "engine", "templates", "package.json");

const EXPECTED_RUNTIME_PINS = {
	cloakbrowser: "0.5.7",
	agentBrowser: "0.34.0",
} as const;

const EXPECTED_TEMPLATE_RANGE_LOWER_BOUNDS = {
	playwright: "^1.62.1",
} as const;

const SUPERSEDED_RUNTIME_PINS = ["0.4.10", "0.5.5", "0.31.1", "0.33.2"] as const;

function readText(path: string): string {
	return readFileSync(path, "utf8");
}

function attributionPin(content: string, heading: RegExp): string[] {
	const lines = content.split("\n");
	const start = lines.findIndex((line) => heading.test(line));
	if (start === -1) return [];
	const rest = lines.slice(start);
	const end = rest.findIndex((line, index) => index > 0 && /^##\s/.test(line));
	const section = (end === -1 ? rest : rest.slice(0, end)).join("\n");
	return [...section.matchAll(/Pinned runtime version:\s*\*\*(?<version>[^*]+)\*\*/g)]
		.map((match) => match.groups?.version?.trim() ?? "");
}

function versionsAfter(content: string, patterns: RegExp[]): string[] {
	const found: string[] = [];
	for (const pattern of patterns) {
		for (const match of content.matchAll(pattern)) {
			const version = match.groups?.version?.trim();
			if (version !== undefined) found.push(version);
		}
	}
	return found;
}

describe("ultimate-browsing Tier-2 runtime pins", () => {
	const attribution = readText(attributionPath);
	const chromeStealth = readText(chromeStealthPath);

	describe("#given the CloakBrowser pin", () => {
		test("#then ATTRIBUTION.md pins the expected version", () => {
			// given the CloakBrowser section of the license notice
			const pins = attributionPin(attribution, /^##\s.*CloakBrowser/);
			// then it declares exactly the expected runtime pin
			expect(pins).toEqual([EXPECTED_RUNTIME_PINS.cloakbrowser]);
		});

		test("#then every chrome-stealth.md occurrence uses the same version", () => {
			// given every machine-consumed CloakBrowser version in the setup reference
			const versions = versionsAfter(chromeStealth, [
				/cloakbrowser==(?<version>\d+\.\d+\.\d+)/g,
				/CloakBrowser\s+(?<version>\d+\.\d+\.\d+)/g,
			]);
			// then at least one install argument exists and all agree with the pin
			expect(versions.length).toBeGreaterThan(0);
			expect([...new Set(versions)]).toEqual([EXPECTED_RUNTIME_PINS.cloakbrowser]);
		});
	});

	describe("#given the agent-browser pin", () => {
		test("#then ATTRIBUTION.md pins the expected version", () => {
			// given the agent-browser section of the license notice
			const pins = attributionPin(attribution, /^##\s.*agent-browser/);
			// then it declares exactly the expected runtime pin
			expect(pins).toEqual([EXPECTED_RUNTIME_PINS.agentBrowser]);
		});

		test("#then every chrome-stealth.md occurrence uses the same version", () => {
			// given every machine-consumed agent-browser version in the setup reference
			const versions = versionsAfter(chromeStealth, [
				/agent-browser@(?<version>\d+\.\d+\.\d+)/g,
				/agent-browser\s+(?<version>\d+\.\d+\.\d+)/g,
			]);
			// then at least one install argument exists and all agree with the pin
			expect(versions.length).toBeGreaterThan(0);
			expect([...new Set(versions)]).toEqual([EXPECTED_RUNTIME_PINS.agentBrowser]);
		});
	});

	describe("#given the two documents together", () => {
		test("#then no stale version string survives anywhere", () => {
			// given the union of both documents
			const combined = `${attribution}\n${chromeStealth}`;
			// then no superseded pin is left behind
			const stale = SUPERSEDED_RUNTIME_PINS.filter((version) => combined.includes(version));
			expect(stale).toEqual([]);
		});
	});

	describe("#given the Playwright template manifest", () => {
		test("#then the playwright range lower bound is current", () => {
			// given the template manifest the engine installs
			const manifest = JSON.parse(readText(templatesManifestPath)) as {
				dependencies?: Record<string, string>;
			};
			// then its playwright range matches the expected lower bound
			expect(manifest.dependencies?.playwright).toBe(
				EXPECTED_TEMPLATE_RANGE_LOWER_BOUNDS.playwright,
			);
		});
	});
});
