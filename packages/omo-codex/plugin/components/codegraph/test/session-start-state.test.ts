import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	clearSessionStartCooldown,
	readSessionStartCooldown,
	recordSessionStartFailure,
} from "../src/session-start-cooldown.ts";
import {
	acquireSessionStartLock,
	releaseSessionStartLock,
} from "../src/session-start-lock.ts";

describe("CodeGraph SessionStart lock", () => {
	it("#given a live project lock #when a second hook acquires it #then the second hook is deduplicated", () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-lock-home-"));
		const projectRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-lock-project-"));
		try {
			const first = acquireSessionStartLock({ homeDir, nowMs: 10_000, projectRoot, staleMs: 60_000 });
			expect(first.kind).toBe("acquired");

			// when
			const second = acquireSessionStartLock({ homeDir, nowMs: 10_001, projectRoot, staleMs: 60_000 });

			// then
			expect(second).toEqual({ kind: "locked" });
			if (first.kind === "acquired") releaseSessionStartLock(first.lock);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});

	it("#given a project lock older than the stale threshold #when another hook acquires it #then the stale lock is recovered", () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-stale-home-"));
		const projectRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-stale-project-"));
		try {
			const first = acquireSessionStartLock({ homeDir, nowMs: 1_000, projectRoot, staleMs: 500 });
			expect(first.kind).toBe("acquired");
			if (first.kind !== "acquired") return;
			const staleDate = new Date(1_000);
			utimesSync(first.lock.path, staleDate, staleDate);

			// when
			const second = acquireSessionStartLock({ homeDir, nowMs: 2_000, projectRoot, staleMs: 500 });

			// then
			expect(second.kind).toBe("acquired");
			if (second.kind === "acquired") {
				expect(second.recoveredStale).toBe(true);
				releaseSessionStartLock(second.lock);
			}
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});

describe("CodeGraph SessionStart cooldown", () => {
	it("#given a failed worker outcome #when the cooldown is checked #then retries are suppressed until expiry and the next failure backs off", () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-cooldown-home-"));
		const projectRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-cooldown-project-"));
		try {
			const first = recordSessionStartFailure({
				action: "failed",
				baseCooldownMs: 1_000,
				homeDir,
				nowMs: 1_000,
				projectRoot,
			});

			// when
			const active = readSessionStartCooldown({ baseCooldownMs: 1_000, homeDir, nowMs: 1_999, projectRoot });
			const expired = readSessionStartCooldown({ baseCooldownMs: 1_000, homeDir, nowMs: 2_000, projectRoot });
			const second = recordSessionStartFailure({
				action: "skipped-status",
				baseCooldownMs: 1_000,
				homeDir,
				nowMs: 2_000,
				projectRoot,
			});

			// then
			expect(first).toMatchObject({ cooldownUntil: 2_000, failureCount: 1 });
			expect(active).toMatchObject({ cooldownUntil: 2_000, failureCount: 1, kind: "active" });
			expect(expired).toEqual({ failureCount: 1, kind: "inactive" });
			expect(second).toMatchObject({ cooldownUntil: 4_000, failureCount: 2 });
			clearSessionStartCooldown({ homeDir, projectRoot });
			expect(readSessionStartCooldown({ baseCooldownMs: 1_000, homeDir, nowMs: 2_001, projectRoot })).toEqual({
				failureCount: 0,
				kind: "inactive",
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});
