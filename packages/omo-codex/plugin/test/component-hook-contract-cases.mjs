import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export function componentHookContractCases(tempRoot) {
	mkdirSync(join(tempRoot, ".omo", "evidence"), { recursive: true });
	writeFileSync(join(tempRoot, ".omo", "evidence", "receipt.txt"), "command output PASS\n".repeat(10));
	const spawnPayload = {
		cwd: tempRoot, hook_event_name: "PreToolUse", model: "gpt-6-astra",
		permission_mode: "default", session_id: "s-spawn-admission", tool_input: { message: "scan" },
		tool_name: "spawn_agent", tool_use_id: "spawn-1", transcript_path: null, turn_id: "t-spawn",
	};
	const marker = join(tempRoot, "plugin-data", "spawn-breaker", "s-spawn-admission.json");
	return [
		{
			name: "ulw-loop post-tool-use successful admission is silent",
			component: "ulw-loop", event: "post-tool-use-spawn",
			payload: { ...spawnPayload, hook_event_name: "PostToolUse", tool_response: { agent_id: "worker-1" } },
			assertOutput(stdout) { assert.equal(stdout, ""); assert.equal(existsSync(marker), false); },
		},
		{
			name: "ulw-loop post-tool-use failed admission records silently",
			component: "ulw-loop", event: "post-tool-use-spawn",
			payload: { ...spawnPayload, hook_event_name: "PostToolUse", tool_response: "AgentLimitReached" },
			assertOutput(stdout) {
				assert.equal(stdout, "");
				const recorded = JSON.parse(readFileSync(marker, "utf8"));
				assert.deepEqual(Object.keys(recorded).sort(), ["at", "reason"]);
				assert.equal(recorded.reason, "AgentLimitReached");
				assert.equal(Number.isFinite(Date.parse(recorded.at)), true);
			},
		},
		{
			name: "ulw-loop admission breaker denies without a plan",
			component: "ulw-loop", event: "pre-tool-use-spawn", payload: spawnPayload,
			assertOutput(stdout) {
				const output = JSON.parse(stdout).hookSpecificOutput;
				assert.equal(output.hookEventName, "PreToolUse");
				assert.equal(output.permissionDecision, "deny");
			},
		},
		{
			name: "ulw-loop clean session admission is silent",
			component: "ulw-loop", event: "pre-tool-use-spawn",
			payload: { ...spawnPayload, session_id: "s-spawn-clean" },
			assertOutput(stdout) { assert.equal(stdout, ""); },
		},
		{
			name: "rules session-start",
			component: "rules",
			event: "session-start",
			payload: {
				hook_event_name: "SessionStart",
				session_id: "s-task12",
				transcript_path: null,
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				source: "startup",
			},
			assertOutput(stdout) {
				const output = JSON.parse(stdout);
				assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
				assert.match(output.hookSpecificOutput.additionalContext, /Hephaestus/);
			},
		},
		{
			name: "telemetry session-start opt-out",
			component: "telemetry",
			event: "session-start",
			payload: {
				hook_event_name: "SessionStart",
				session_id: "s-task12",
				transcript_path: null,
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				source: "startup",
			},
			assertOutput(stdout) {
				assert.equal(stdout, "");
			},
		},
		{
			name: "ultrawork user-prompt-submit trigger",
			component: "ultrawork",
			event: "user-prompt-submit",
			payload: {
				hook_event_name: "UserPromptSubmit",
				session_id: "s-task12",
				turn_id: "t-task12",
				transcript_path: null,
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				prompt: "ulw this",
			},
			assertOutput(stdout) {
				const output = JSON.parse(stdout);
				assert.equal(
					output.hookSpecificOutput.hookEventName,
					"UserPromptSubmit",
				);
				assert.match(
					output.hookSpecificOutput.additionalContext,
					/<ultrawork-mode>/,
				);
			},
		},
		{
			name: "ulw-loop pre-tool-use budget guard",
			component: "ulw-loop",
			event: "pre-tool-use",
			payload: {
				hook_event_name: "PreToolUse",
				session_id: "s-task12",
				turn_id: "t-task12",
				transcript_path: null,
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				tool_name: "create_goal",
				tool_use_id: "tool-task12",
				tool_input: { objective: "x", token_budget: 100 },
			},
			assertOutput(stdout) {
				const output = JSON.parse(stdout);
				assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
				assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
				assert.match(
					output.hookSpecificOutput.additionalContext,
					/Omit token_budget/,
				);
			},
		},
		{
			name: "git-bash pre-tool-use windows reminder",
			component: "git-bash",
			event: "pre-tool-use",
			payload: {
				hook_event_name: "PreToolUse",
				session_id: "s-task12-windows",
				turn_id: "t-task12",
				transcript_path: null,
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				tool_name: "Bash",
				tool_use_id: "tool-task12",
				tool_input: { cmd: "pwd" },
			},
			env: { OS: "Windows_NT" },
			assertOutput(stdout) {
				const output = JSON.parse(stdout);
				assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
				assert.match(
					output.hookSpecificOutput.additionalContext,
					/git_bash MCP/,
				);
			},
		},
		{
			name: "comment-checker post-tool-use no requests",
			component: "comment-checker",
			event: "post-tool-use",
			payload: {
				hook_event_name: "PostToolUse",
				session_id: "s-task12",
				turn_id: "t-task12",
				transcript_path: null,
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				tool_name: "Read",
				tool_use_id: "tool-task12",
				tool_input: {},
				tool_response: { text: "ok" },
			},
			assertOutput(stdout) {
				assert.equal(stdout, "");
			},
		},
		{
			name: "teammode post-tool-use create-thread title reminder",
			component: "teammode",
			event: "post-tool-use",
			payload: {
				hook_event_name: "PostToolUse",
				session_id: "s-task12",
				turn_id: "t-task12",
				transcript_path: null,
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				tool_name: "create_thread",
				tool_use_id: "tool-task12",
				tool_input: { prompt: "Investigate flaky release packaging" },
				tool_response: { threadId: "thread-task12" },
			},
			assertOutput(stdout) {
				const output = JSON.parse(stdout);
				assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
				assert.match(output.hookSpecificOutput.additionalContext, /codex_app\.set_thread_title/);
				assert.match(output.hookSpecificOutput.additionalContext, /thread-task12/);
			},
		},
		{
			name: "lsp post-compact reset",
			component: "lsp",
			event: "post-compact",
			payload: {
				hook_event_name: "PostCompact",
				session_id: "s-task12",
				turn_id: "t-task12",
				transcript_path: null,
				cwd: tempRoot,
				model: "gpt-5.5",
				trigger: "manual",
			},
			assertOutput(stdout) {
				assert.equal(stdout, "");
			},
		},
		{
			name: "lazycodex worker verifier subagent-stop blocks missing evidence",
			component: "lazycodex-executor-verify",
			event: "subagent-stop",
			payload: {
				hook_event_name: "SubagentStop",
				agent_type: "lazycodex-worker-medium",
				agent_id: "agent-task12",
				session_id: "s-task12",
				transcript_path: join(tempRoot, "transcript.jsonl"),
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				stop_hook_active: true,
				last_assistant_message: "PASS",
			},
			assertOutput(stdout) {
				const output = JSON.parse(stdout);
				assert.equal(output.decision, "block");
				assert.match(output.reason, /\.omo\/evidence\//);
			},
		},
		{
			name: "lazycodex worker verifier passes receipt with nonexistent transcript",
			component: "lazycodex-executor-verify",
			event: "subagent-stop",
			payload: {
				hook_event_name: "SubagentStop",
				agent_type: "lazycodex-worker-medium",
				agent_id: "agent-task12",
				session_id: "s-task12",
				turn_id: "t-task12",
				transcript_path: join(tempRoot, "transcript.jsonl"),
				agent_transcript_path: join(tempRoot, "agent-transcript.jsonl"),
				cwd: tempRoot,
				model: "gpt-6-astra",
				permission_mode: "default",
				stop_hook_active: true,
				last_assistant_message: "done\nEVIDENCE_RECORDED: .omo/evidence/receipt.txt",
			},
			assertOutput(stdout) {
				assert.equal(stdout, "");
			},
		},
		{
			name: "ulw-execute-continuation stop no state",
			component: "ulw-execute-continuation",
			event: "stop",
			payload: {
				hook_event_name: "Stop",
				session_id: "s-task12",
				turn_id: "t-task12",
				transcript_path: join(tempRoot, "transcript.jsonl"),
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				stop_hook_active: false,
			},
			assertOutput(stdout) {
				assert.equal(stdout, "");
			},
		},
		{
			name: "ulw-execute-continuation subagent-stop compatibility no-op",
			component: "ulw-execute-continuation",
			event: "subagent-stop",
			payload: {
				hook_event_name: "SubagentStop",
				agent_id: "agent-task12",
				agent_type: "lazycodex-worker-low",
				session_id: "s-task12",
				turn_id: "t-task12",
				transcript_path: join(tempRoot, "transcript.jsonl"),
				agent_transcript_path: join(tempRoot, "agent-transcript.jsonl"),
				cwd: tempRoot,
				model: "gpt-5.5",
				permission_mode: "default",
				stop_hook_active: false,
				last_assistant_message: "done",
			},
			assertOutput(stdout) {
				assert.equal(stdout, "");
			},
		},
	];
}
