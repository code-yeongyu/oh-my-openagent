import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	canonicalReviewerAgentName,
	GATE_REVIEWER_AGENT_NAMES,
	LEGACY_REVIEWER_AGENT_ALIASES,
	REVIEWER_ROLES_BY_SURFACE,
	resolveToolkitSurface,
	reviewerRolesFor,
} from "../src/surface.ts";

let markerDir: string;

beforeEach(async () => {
	markerDir = await mkdtemp(join(tmpdir(), "ulw-surface-"));
});

afterEach(async () => {
	await rm(markerDir, { recursive: true, force: true });
});

describe("resolveToolkitSurface", () => {
	it("#given no marker and no env #when resolved #then defaults to lazycodex", () => {
		expect(resolveToolkitSurface({ env: {}, entryDir: markerDir })).toBe("lazycodex");
	});

	it("#given a staged omo-senpi marker #when resolved #then returns omo-senpi", async () => {
		await writeFile(join(markerDir, "surface.json"), '{"surface":"omo-senpi"}\n', "utf8");

		expect(resolveToolkitSurface({ env: {}, entryDir: markerDir })).toBe("omo-senpi");
	});

	it("#given the env override #when a conflicting marker exists #then the env wins", async () => {
		await writeFile(join(markerDir, "surface.json"), '{"surface":"omo-senpi"}\n', "utf8");

		expect(resolveToolkitSurface({ env: { OMO_AGENT_TOOLKIT_SURFACE: "lazycodex" }, entryDir: markerDir })).toBe(
			"lazycodex",
		);
	});

	it("#given an omo-senpi env override without marker #when resolved #then returns omo-senpi", () => {
		expect(resolveToolkitSurface({ env: { OMO_AGENT_TOOLKIT_SURFACE: "omo-senpi" }, entryDir: markerDir })).toBe(
			"omo-senpi",
		);
	});

	it("#given malformed or unknown markers #when resolved #then falls back to lazycodex", async () => {
		await writeFile(join(markerDir, "surface.json"), "not json at all", "utf8");
		expect(resolveToolkitSurface({ env: {}, entryDir: markerDir })).toBe("lazycodex");

		await writeFile(join(markerDir, "surface.json"), '{"surface":"unknown-surface"}\n', "utf8");
		expect(resolveToolkitSurface({ env: {}, entryDir: markerDir })).toBe("lazycodex");
	});

	it("#given an unknown env value #when a valid marker exists #then the marker still applies", async () => {
		await writeFile(join(markerDir, "surface.json"), '{"surface":"omo-senpi"}\n', "utf8");

		expect(resolveToolkitSurface({ env: { OMO_AGENT_TOOLKIT_SURFACE: "bogus" }, entryDir: markerDir })).toBe(
			"omo-senpi",
		);
	});
});

describe("reviewerRolesFor", () => {
	it("#given each surface #when resolving roles #then the identity namespaces match the surface", () => {
		expect(reviewerRolesFor("lazycodex")).toEqual({
			codeReview: "lazycodex-code-reviewer",
			manualQa: "lazycodex-qa-executor",
			gateReview: "lazycodex-gate-reviewer",
		});
		expect(reviewerRolesFor("omo-senpi")).toEqual({
			codeReview: "omo-native-code-reviewer",
			manualQa: "omo-native-qa-executor",
			gateReview: "omo-native-gate-reviewer",
		});
		expect(Object.keys(REVIEWER_ROLES_BY_SURFACE).sort()).toEqual(["lazycodex", "omo-senpi"]);
	});
});

describe("canonicalReviewerAgentName", () => {
	it("#given a retired reviewer spelling #when canonicalized #then it maps to the omo-native name", () => {
		expect(canonicalReviewerAgentName("omo-senpi-gate-reviewer")).toBe("omo-native-gate-reviewer");
		expect(canonicalReviewerAgentName("omo-senpi-code-reviewer")).toBe("omo-native-code-reviewer");
		expect(canonicalReviewerAgentName("omo-senpi-qa-executor")).toBe("omo-native-qa-executor");
	});

	it("#given a canonical or unrelated name #when canonicalized #then it is returned unchanged", () => {
		expect(canonicalReviewerAgentName("omo-native-gate-reviewer")).toBe("omo-native-gate-reviewer");
		expect(canonicalReviewerAgentName("lazycodex-gate-reviewer")).toBe("lazycodex-gate-reviewer");
		expect(canonicalReviewerAgentName("explore")).toBe("explore");
	});

	it("#given every retired alias #when mapped #then each target is a live reviewer role", () => {
		const liveRoles = new Set(
			Object.values(REVIEWER_ROLES_BY_SURFACE).flatMap((roles) => [
				roles.codeReview,
				roles.manualQa,
				roles.gateReview,
			]),
		);
		for (const canonical of Object.values(LEGACY_REVIEWER_AGENT_ALIASES)) expect(liveRoles.has(canonical)).toBe(true);
	});

	it("#given the gate reviewer name set #when read #then it carries both the canonical and the retired spelling", () => {
		expect(GATE_REVIEWER_AGENT_NAMES.has("omo-native-gate-reviewer")).toBe(true);
		expect(GATE_REVIEWER_AGENT_NAMES.has("omo-senpi-gate-reviewer")).toBe(true);
		expect(GATE_REVIEWER_AGENT_NAMES.has("lazycodex-gate-reviewer")).toBe(true);
		expect(GATE_REVIEWER_AGENT_NAMES.has("omo-native-code-reviewer")).toBe(false);
	});
});
