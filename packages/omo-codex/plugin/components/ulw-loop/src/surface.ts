import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The agent toolkit ships on two surfaces: the LazyCodex (Codex CLI) plugin runs the component
// bundle directly, while omo-senpi stages the same bundle through stage-agent-toolkit.mjs. The
// reviewer identities the final quality gate enforces differ per surface, so the staging script
// bakes a `surface.json` marker next to the staged bundle and this module resolves it. Without a
// marker (the Codex layout) the surface stays "lazycodex".
export type UlwLoopToolkitSurface = "lazycodex" | "omo-senpi";

export interface UlwLoopReviewerRoles {
	readonly codeReview: string;
	readonly manualQa: string;
	readonly gateReview: string;
}

export const REVIEWER_ROLES_BY_SURFACE: Readonly<Record<UlwLoopToolkitSurface, UlwLoopReviewerRoles>> = {
	lazycodex: {
		codeReview: "lazycodex-code-reviewer",
		manualQa: "lazycodex-qa-executor",
		gateReview: "lazycodex-gate-reviewer",
	},
	"omo-senpi": {
		codeReview: "omo-senpi-code-reviewer",
		manualQa: "omo-senpi-qa-executor",
		gateReview: "omo-senpi-gate-reviewer",
	},
};

export const GATE_REVIEWER_AGENT_NAMES: ReadonlySet<string> = new Set(
	Object.values(REVIEWER_ROLES_BY_SURFACE).map((roles) => roles.gateReview),
);

export type UlwLoopGateSection = "codeReview" | "manualQa" | "gateReview" | "iteration" | "criteriaCoverage";

export const REQUIRED_GATE_SECTIONS_BY_SURFACE: Readonly<Record<UlwLoopToolkitSurface, readonly UlwLoopGateSection[]>> =
	{
		lazycodex: ["codeReview", "manualQa", "gateReview", "iteration", "criteriaCoverage"],
		"omo-senpi": ["manualQa", "gateReview", "iteration", "criteriaCoverage"],
	};

export const GATE_SECTION_BY_ACCEPTOR: Readonly<
	Record<UlwLoopToolkitSurface, Readonly<Partial<Record<UlwLoopGateSection, readonly string[]>>>>
> = {
	lazycodex: {
		codeReview: [REVIEWER_ROLES_BY_SURFACE.lazycodex.codeReview],
		manualQa: [REVIEWER_ROLES_BY_SURFACE.lazycodex.manualQa],
		gateReview: [REVIEWER_ROLES_BY_SURFACE.lazycodex.gateReview],
	},
	"omo-senpi": {
		manualQa: ["main-session"],
		gateReview: ["category:deep", "category:unspecified-high", "category:unspecified-low"],
	},
};

export function reviewerRolesFor(surface: UlwLoopToolkitSurface): UlwLoopReviewerRoles {
	return REVIEWER_ROLES_BY_SURFACE[surface];
}

export const SURFACE_MARKER_FILENAME = "surface.json";
const SURFACE_ENV_KEY = "OMO_AGENT_TOOLKIT_SURFACE";

function parseSurface(value: unknown): UlwLoopToolkitSurface | null {
	return value === "lazycodex" || value === "omo-senpi" ? value : null;
}

export interface ResolveToolkitSurfaceOptions {
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly entryDir?: string;
}

// Resolution order: explicit env override (tests, doctor probes) -> staged surface.json marker
// sitting next to the running bundle -> lazycodex default. The marker is distribution-baked, so a
// malformed marker falls back to the default instead of crashing checkpoint validation; the env
// override remains available to force the intended surface on a damaged install.
export function resolveToolkitSurface(options?: ResolveToolkitSurfaceOptions): UlwLoopToolkitSurface {
	const env = options?.env ?? process.env;
	const fromEnv = parseSurface(env[SURFACE_ENV_KEY]);
	if (fromEnv !== null) return fromEnv;
	const entryDir = options?.entryDir ?? dirname(fileURLToPath(import.meta.url));
	const markerPath = join(entryDir, SURFACE_MARKER_FILENAME);
	return readMarkerSurface(markerPath) ?? "lazycodex";
}

function readMarkerSurface(markerPath: string): UlwLoopToolkitSurface | null {
	try {
		if (!existsSync(markerPath)) return null;
		const parsed = JSON.parse(readFileSync(markerPath, "utf8")) as Record<string, unknown>;
		return parseSurface(parsed["surface"]);
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}
