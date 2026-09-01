import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REVIEWER_ROLES_BY_SURFACE, resolveToolkitSurface, reviewerRolesFor } from "../src/surface.ts";

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
			codeReview: "omo-senpi-code-reviewer",
			manualQa: "omo-senpi-qa-executor",
			gateReview: "omo-senpi-gate-reviewer",
		});
		expect(Object.keys(REVIEWER_ROLES_BY_SURFACE).sort()).toEqual(["lazycodex", "omo-senpi"]);
	});
});
