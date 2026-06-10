import { afterEach, describe, expect, it } from "vitest";

import { runPostCompactHook, runSessionStartHook } from "../src/codex-hook.js";
import {
	cleanupPostCompactFixtures,
	compactSessionStartInput,
	EXPANDED_POST_COMPACT_ENV,
	makeOversizedProject,
	PROJECT_RULES_ENV,
	postCompactInput,
	readAdditionalContext,
	readOptionalAdditionalContext,
	writeCompactedTranscript,
	writeCompactedWarningTranscript,
	writeMalformedContextTooLargeTranscript,
} from "./post-compact-test-fixture.ts";

afterEach(() => {
	cleanupPostCompactFixtures();
});

describe("codex rules compacted context recovery", () => {
	it("#given compacted session source after PostCompact #when static recovery runs #then output is a mandatory read directive", async () => {
		// given
		const { root, pluginData } = makeOversizedProject("compact-source");
		const transcriptPath = writeCompactedTranscript(root, "summary dropped injected rules");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_RULES_ENV,
		});

		// then
		const postCompactContext = readAdditionalContext(output);
		expect(postCompactContext.length).toBeLessThan(2_000);
		expect(postCompactContext).toContain("MUST READ");
		expect(postCompactContext).toContain("CONTEXT.md");
		expect(postCompactContext).not.toContain("Project rule");
	});

	it("#given compacted context warning and near-full transcript #when compact source starts twice #then handles compacted context warning once", async () => {
		// given
		const { root, pluginData } = makeOversizedProject("warning-once");
		const transcriptPath = writeCompactedWarningTranscript(root, "C".repeat(760_000));
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const firstOutput = await runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: EXPANDED_POST_COMPACT_ENV,
		});
		const secondOutput = await runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: EXPANDED_POST_COMPACT_ENV,
		});

		// then
		const firstContext = readOptionalAdditionalContext(firstOutput);
		expect(firstContext.length).toBeLessThan(1_000);
		expect(firstContext).toContain("MUST READ");
		expect(firstContext).toContain("CONTEXT.md");
		expect(secondOutput).toBe("");
	});

	it("#given context-too-large marker with compacted small summary #when compact source starts #then emits emergency-sized context", async () => {
		// given
		const { root, pluginData } = makeOversizedProject("warning-small");
		const transcriptPath = writeCompactedWarningTranscript(root, "small compacted summary");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: EXPANDED_POST_COMPACT_ENV,
		});

		// then
		const context = readOptionalAdditionalContext(output);
		expect(context.length).toBeLessThan(1_000);
		expect(context).toContain("MUST READ");
		expect(context).toContain("CONTEXT.md");
	});

	it("#given compact SessionStart without prior PostCompact state #when context-pressure transcript is present #then emits emergency-sized context", async () => {
		// given
		const { root, pluginData } = makeOversizedProject("compact-no-state");
		const transcriptPath = writeCompactedWarningTranscript(root, "small compacted summary");

		// when
		const output = await runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: EXPANDED_POST_COMPACT_ENV,
		});

		// then
		const context = readOptionalAdditionalContext(output);
		expect(context.length).toBeLessThan(1_000);
		expect(context).toContain("MUST READ");
		expect(context).toContain("CONTEXT.md");
	});

	it("#given malformed context-too-large transcript and empty session data #when compact source starts #then ignores malformed oversize markers safely", async () => {
		// given
		const { root, pluginData } = makeOversizedProject("malformed");
		const transcriptPath = writeMalformedContextTooLargeTranscript(root, "D".repeat(760_000));
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: EXPANDED_POST_COMPACT_ENV,
		});

		// then
		const context = readOptionalAdditionalContext(output);
		expect(context.length).toBeLessThan(1_000);
		expect(context).toContain("MUST READ");
		expect(context).toContain("CONTEXT.md");
	});

	it("#given concurrent compact SessionStart triggers #when both recover context-too-large state #then deduplicates concurrent context-too-large recovery", async () => {
		// given
		const { root, pluginData } = makeOversizedProject("concurrent");
		const transcriptPath = writeCompactedWarningTranscript(root, "E".repeat(760_000));
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const outputs = await Promise.all([
			runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
				pluginDataRoot: pluginData,
				env: EXPANDED_POST_COMPACT_ENV,
			}),
			runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
				pluginDataRoot: pluginData,
				env: EXPANDED_POST_COMPACT_ENV,
			}),
		]);

		// then
		const contexts = outputs.map(readOptionalAdditionalContext);
		expect(contexts.filter((context) => context.length > 0)).toHaveLength(1);
		expect(contexts.join("").length).toBeLessThan(1_000);
		expect(contexts.join("")).toContain("MUST READ");
		expect(contexts.join("")).toContain("CONTEXT.md");
	});
});
