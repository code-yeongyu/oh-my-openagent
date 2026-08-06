import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	claimPostCompactPending,
	isPostCompactPending,
	isPostCompactRecoveryInProgress,
	markSessionCompacted,
	sessionCachePath,
} from "../src/persistent-cache.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("persistent post-compact state", () => {
	it("#given post-compact pending state #when static recovery is claimed twice #then only the first caller proceeds", () => {
		// given
		const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-cache-"));
		tempDirectories.push(pluginData);
		const cachePath = sessionCachePath("session-cache-claim", pluginData);
		markSessionCompacted(cachePath);

		// when
		const firstClaim = claimPostCompactPending(cachePath, "static");
		const secondClaim = claimPostCompactPending(cachePath, "static");

		// then
		expect(firstClaim).toBe("claimed");
		expect(secondClaim).toBe("not-pending");
		expect(isPostCompactPending(cachePath, "static")).toBe(false);
		expect(isPostCompactRecoveryInProgress(cachePath, "static")).toBe(true);
		expect(isPostCompactPending(cachePath, "dynamic")).toBe(true);
	});

	it("#given post-compact pending state and contended lock #when static recovery is claimed #then reports contention without consuming pending state", () => {
		// given
		const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-cache-"));
		tempDirectories.push(pluginData);
		const cachePath = sessionCachePath("session-cache-contended", pluginData);
		markSessionCompacted(cachePath);
		const lockPath = `${cachePath}.lock`;
		mkdirSync(lockPath);

		try {
			// when
			const claim = claimPostCompactPending(cachePath, "static");

			// then
			expect(claim).toBe("contended");
			expect(isPostCompactPending(cachePath, "static")).toBe(true);
			expect(isPostCompactRecoveryInProgress(cachePath, "static")).toBe(false);
		} finally {
			rmSync(lockPath, { recursive: true, force: true });
		}
	});
});
