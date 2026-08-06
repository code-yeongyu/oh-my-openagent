import { mkdirSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { runPostCompactHook, runSessionStartHook } from "../src/codex-hook.js";
import { sessionCachePath } from "../src/persistent-cache.js";
import {
	cleanupPostCompactFixtures,
	compactSessionStartInput,
	EXPANDED_POST_COMPACT_ENV,
	makeOversizedProject,
	postCompactInput,
	writeCompactedWarningTranscript,
} from "./post-compact-test-fixture.ts";

const SESSION_ID = "session-post-compact-lock";

afterEach(() => {
	cleanupPostCompactFixtures();
});

describe("codex rules post-compact lock contention", () => {
	it("#given compacted session state while cache lock is contended #when compact source starts #then skips fail-open rule injection", async () => {
		// given
		const { root, pluginData } = makeOversizedProject("lock");
		const transcriptPath = writeCompactedWarningTranscript(root, "F".repeat(760_000));
		await runPostCompactHook(
			{ ...postCompactInput(root, SESSION_ID), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);
		const lockPath = `${sessionCachePath(SESSION_ID, pluginData)}.lock`;
		mkdirSync(lockPath);

		try {
			// when
			const output = await runSessionStartHook(compactSessionStartInput(root, transcriptPath, SESSION_ID), {
				pluginDataRoot: pluginData,
				env: EXPANDED_POST_COMPACT_ENV,
			});

			// then
			expect(output).toBe("");
		} finally {
			rmSync(lockPath, { recursive: true, force: true });
		}
	});
});
