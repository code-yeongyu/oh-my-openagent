import assert from "node:assert/strict";
import test from "node:test";

import { forceDisableMultiAgentV2 } from "../scripts/migrate-codex-config/multi-agent-v2-guard.mjs";

test("#given enabled = true with an inline comment #when forcing disable #then flips to false and preserves the comment", () => {
	const config = [
		"[features.multi_agent_v2]",
		"enabled = true # tuned by me",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v1" });

	assert.match(result, /^enabled = false # tuned by me$/m);
	assert.doesNotMatch(result, /enabled = true/);
	assert.equal((result.match(/^\s*enabled\s*=/gm) ?? []).length, 1);
	assert.equal((result.match(/\[features\.multi_agent_v2\]/g) ?? []).length, 1);
});

test("#given a section header with an inline comment #when forcing disable #then patches in place without duplicating the table", () => {
	const config = [
		"[features.multi_agent_v2] # pinned by me",
		"enabled = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v1" });

	assert.equal((result.match(/\[features\.multi_agent_v2\]/g) ?? []).length, 1);
	assert.match(result, /enabled = false/);
	assert.doesNotMatch(result, /enabled = true/);
	assert.match(result, /# pinned by me/);
});

test("#given an already-guarded commented config #when re-running #then output is byte-identical", () => {
	const configA = [
		"[features.multi_agent_v2]",
		"enabled = true # tuned by me",
		"",
	].join("\n");
	const configB = [
		"[features.multi_agent_v2] # pinned by me",
		"enabled = true",
		"",
	].join("\n");

	const firstA = forceDisableMultiAgentV2(configA, { multiAgentVersion: "v1" });
	const rerunA = forceDisableMultiAgentV2(firstA, { multiAgentVersion: "v1" });
	assert.equal(rerunA, firstA);

	const firstB = forceDisableMultiAgentV2(configB, { multiAgentVersion: "v1" });
	const rerunB = forceDisableMultiAgentV2(firstB, { multiAgentVersion: "v1" });
	assert.equal(rerunB, firstB);
});

test("#given user-disabled with an inline comment #when forcing disable #then returns config unchanged", () => {
	const config = [
		"[features.multi_agent_v2]",
		"enabled = false # I turned this off myself",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v1" });

	assert.equal(result, config);
});

test("#given [features] shorthand true with an inline comment #when forcing disable #then removes the shorthand and appends one disabled table", () => {
	const config = [
		"[features]",
		"plugins = true",
		"multi_agent_v2 = true # legacy",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v1" });

	assert.doesNotMatch(result, /^\s*multi_agent_v2\s*=/m);
	assert.equal((result.match(/\[features\.multi_agent_v2\]/g) ?? []).length, 1);
	assert.match(result, /\[features\.multi_agent_v2\]\nenabled = false\n/);
	assert.match(result, /plugins = true/);
});

test("#given a following section header with an inline comment #when inserting enabled=false #then does not leak into the next section", () => {
	const config = [
		"[features.multi_agent_v2]",
		"max_concurrent_threads_per_session = 2",
		"[mcp_servers.x] # note",
		"enabled = true",
		"",
	].join("\n");

	const result = forceDisableMultiAgentV2(config, { multiAgentVersion: "v1" });

	assert.match(result, /\[features\.multi_agent_v2\]\nenabled = false\n/);
	assert.match(result, /\[mcp_servers\.x\][^\n]*\nenabled = true/);
});
