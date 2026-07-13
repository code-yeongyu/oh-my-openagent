import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { designpowersMaterializeMap, designpowersRelativePaths } from "./designpowers-refs-manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const sharedSkillsRoot = join(here, "..");
export const frontendSkillRoot = join(sharedSkillsRoot, "skills", "frontend");
export const upstreamsRoot = join(sharedSkillsRoot, "upstreams");

export const designOriginals = [
	"README.md",
	"_INDEX.md",
	"aside.md",
	"clone-from-url.md",
	"design-system-architecture.md",
	"layout-skill.md",
	"lazyweb.md",
	"react-dev-tooling-skill.md",
];

export const brandStems = [
	"airbnb", "airtable", "apple", "binance", "bmw", "bugatti", "cal", "claude", "clay", "clickhouse",
	"cohere", "coinbase", "composio", "cursor", "elevenlabs", "expo", "ferrari", "figma", "framer", "hashicorp",
	"ibm", "intercom", "kraken", "lamborghini", "linear.app", "lovable", "mastercard", "meta", "minimax", "mintlify",
	"miro", "mistral.ai", "mongodb", "nike", "notion", "nvidia", "ollama", "opencode.ai", "pinterest", "playstation",
	"posthog", "raycast", "renault", "replicate", "resend", "revolut", "runwayml", "sanity", "sentry", "shopify",
	"spacex", "spotify", "starbucks", "stripe", "supabase", "superhuman", "tesla", "theverge", "together.ai", "uber",
	"vercel", "vodafone", "voltagent", "warp", "webflow", "wired", "wise", "x.ai", "zapier",
];

export const tasteSkillFiles = {
	"taste-skill.md": "skills/taste-skill/SKILL.md",
	"gpt-tasteskill.md": "skills/gpt-tasteskill/SKILL.md",
	"minimalist-skill.md": "skills/minimalist-skill/SKILL.md",
	"brutalist-skill.md": "skills/brutalist-skill/SKILL.md",
	"soft-skill.md": "skills/soft-skill/SKILL.md",
	"redesign-skill.md": "skills/redesign-skill/SKILL.md",
	"image-to-code-skill.md": "skills/image-to-code-skill/SKILL.md",
	"output-skill.md": "skills/output-skill/SKILL.md",
	"stitch-skill.md": "skills/stitch-skill/SKILL.md",
	"imagegen-frontend-web.md": "skills/imagegen-frontend-web/SKILL.md",
	"imagegen-frontend-mobile.md": "skills/imagegen-frontend-mobile/SKILL.md",
	"imagegen-brandkit.md": "skills/brandkit/SKILL.md",
};

// Non-SKILL.md taste-skill artifact: upstream ships stitch-skill with a worked
// example of the DESIGN.md document that skill exports.
export const tasteSkillArtifactFiles = {
	"stitch-design-example.md": "skills/stitch-skill/DESIGN.md",
};

export const uiUxDbFileRenames = {
	"data/web-interface.csv": "data/app-interface.csv",
};

const uiUxDbStackFiles = [
	"astro",
	"flutter",
	"html-tailwind",
	"jetpack-compose",
	"nextjs",
	"nuxt-ui",
	"nuxtjs",
	"react-native",
	"react",
	"shadcn",
	"svelte",
	"swiftui",
	"vue",
];

const uiUxDbDataFiles = [
	"charts",
	"colors",
	"icons",
	"landing",
	"products",
	"react-performance",
	"styles",
	"typography",
	"ui-reasoning",
	"ux-guidelines",
	"web-interface",
];

export const uiUxDbScripts = ["core.py", "design_system.py", "search.py"];

function upstreamBrandDir(brand) {
	return brand.replace(/\./g, "-");
}

export function brandDesignFiles() {
	return brandStems.map((brand) => `${brand}.md`).sort();
}

export function designMaterializeMap() {
	const map = {};
	for (const brand of brandStems) {
		map[`references/design/${brand}.md`] = {
			upstream: "open-design",
			source: `design-systems/${upstreamBrandDir(brand)}/DESIGN.md`,
		};
	}
	for (const [fileName, source] of Object.entries(tasteSkillFiles)) {
		map[`references/design/${fileName}`] = { upstream: "taste-skill", source };
	}
	for (const [fileName, source] of Object.entries(tasteSkillArtifactFiles)) {
		map[`references/design/${fileName}`] = { upstream: "taste-skill", source };
	}
	return map;
}

export function uiUxDbMaterializeMap() {
	const map = {};
	map["references/ui-ux-db/README.md"] = { upstream: "ui-ux-pro-max", source: ".claude/skills/ui-ux-pro-max/SKILL.md" };
	for (const name of uiUxDbScripts) {
		map[`references/ui-ux-db/scripts/${name}`] = {
			upstream: "ui-ux-pro-max",
			source: `src/ui-ux-pro-max/scripts/${name}`,
		};
	}
	for (const name of uiUxDbDataFiles) {
		const ours = `data/${name}.csv`;
		const upstreamRel = uiUxDbFileRenames[ours] ?? ours;
		map[`references/ui-ux-db/${ours}`] = {
			upstream: "ui-ux-pro-max",
			source: `src/ui-ux-pro-max/${upstreamRel}`,
		};
	}
	for (const name of uiUxDbStackFiles) {
		map[`references/ui-ux-db/data/stacks/${name}.csv`] = {
			upstream: "ui-ux-pro-max",
			source: `src/ui-ux-pro-max/data/stacks/${name}.csv`,
		};
	}
	return map;
}

export function thirdPartyMaterializeMap() {
	return { ...designMaterializeMap(), ...uiUxDbMaterializeMap(), ...designpowersMaterializeMap() };
}

export function thirdPartyRelativePaths() {
	return Object.keys(thirdPartyMaterializeMap()).sort();
}

export function designpowersThirdPartyRelativePaths() {
	return designpowersRelativePaths();
}

export function keptDesignRelativePaths() {
	return designOriginals.map((name) => `references/design/${name}`).sort();
}
