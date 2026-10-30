// Scenarios for computer-control-live-macos.mjs: each drives one senpi rpc session and checks the engine audit
// and the `computer` tool results it left behind.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const REASON = "QA: raise the QA target window";
export const CONFIRM_TITLE = "Allow foreground computer control?";
export const TARGET_TITLE = `omo-control-qa-${process.pid}`;

export function jsonLines(text) {
	return text.split("\n").flatMap((line) => {
		if (!line.trim().startsWith("{")) return [];
		try {
			return [JSON.parse(line)];
		} catch {
			return [];
		}
	});
}

function filesNamed(root, name, found = []) {
	if (!existsSync(root)) return found;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) filesNamed(path, name, found);
		else if (entry.name === name) found.push(path);
	}
	return found;
}

export const auditActions = (root) =>
	filesNamed(root, ".computer-audit.jsonl")
		.flatMap((path) => jsonLines(readFileSync(path, "utf8")))
		.filter((entry) => typeof entry.action === "string")
		.map((entry) => `${entry.action}:${entry.status}`);

export const sessionFiles = (agentDir) => {
	const root = join(agentDir, "sessions");
	if (!existsSync(root)) return [];
	return readdirSync(root, { recursive: true })
		.map(String)
		.filter((name) => name.endsWith(".jsonl"))
		.map((name) => join(root, name));
};

// In file order: one entry per `computer` tool result, its text parts joined.
export const toolResults = (agentDir) =>
	sessionFiles(agentDir)
		.flatMap((path) => jsonLines(readFileSync(path, "utf8")))
		.map((entry) => entry.message ?? entry)
		.filter(
			(message) =>
				message?.role === "toolResult" && message.toolName === "computer",
		)
		.map((message) =>
			(message.content ?? []).map((part) => part?.text ?? "").join("\n"),
		);

const raiseCode = `const w = await desktop.window({ title: ${JSON.stringify(TARGET_TITLE)} }); await w.raise(); return "raised"`;
const run = (code) => ({
	type: "tool_call",
	name: "computer",
	arguments: { action: "run", code },
});
const acquire = `const state = await desktop.control.acquire({ reason: ${JSON.stringify(REASON)} });`;

function answerConfirms(session, answer) {
	const answered = new Set();
	return () => {
		for (const event of session.events) {
			if (
				event.type === "extension_ui_request" &&
				event.method === "confirm" &&
				event.title === CONFIRM_TITLE &&
				!answered.has(event.id)
			) {
				answered.add(event.id);
				session.send({
					type: "extension_ui_response",
					id: event.id,
					confirmed: answer,
				});
			}
		}
		return false;
	};
}

export const scenarios = {
	"approved-then-ended": {
		steps: [
			run(
				`${acquire} ${raiseCode.replace('return "raised"', "return JSON.stringify({ state, raised: true })")}`,
			),
			{ type: "text", text: "done" },
			run(raiseCode),
			{ type: "text", text: "done" },
		],
		async drive(session) {
			const answer = answerConfirms(session, true);
			session.send({
				type: "prompt",
				message: "control QA: acquire and raise",
			});
			await session.until("the first agent_end", () => {
				answer();
				return session.agentEnds() >= 1;
			});
			await session.until("control.revoke after agent_end", () =>
				auditActions(session.sandbox.root).includes("control.revoke:success"),
			);
			session.send({ type: "prompt", message: "control QA: raise again" });
			await session.until(
				"the second agent_end",
				() => session.agentEnds() >= 2,
			);
		},
		verify: ({ audits, results }) => [
			[
				"the first run reported an active grant",
				results[0]?.includes('"active":true') === true,
			],
			[
				"the first raise was admitted",
				results[0]?.includes('"raised":true') === true,
			],
			[
				"the engine audited control.grant, then raiseWindow",
				audits.indexOf("control.grant:success") !== -1 &&
					audits.indexOf("raiseWindow:success") >
						audits.indexOf("control.grant:success"),
			],
			[
				"the end of the task revoked the grant",
				audits.includes("control.revoke:success"),
			],
			[
				"the raise after the task ended was refused COMPUTER_CONTROL_REQUIRED",
				results[1]?.includes("COMPUTER_CONTROL_REQUIRED") === true,
			],
			[
				"the engine audited that refusal as an error",
				audits.at(-1) === "raiseWindow:error",
			],
		],
	},
	interrupted: {
		steps: [
			run(`${acquire} await wait(30000); return JSON.stringify(state)`),
			// The abort ends the first turn before it asks the provider again.
			run(raiseCode),
			{ type: "text", text: "done" },
		],
		async drive(session) {
			const answer = answerConfirms(session, true);
			session.send({
				type: "prompt",
				message: "control QA: acquire then wait",
			});
			await session.until("control.grant in the audit", () => {
				answer();
				return auditActions(session.sandbox.root).includes(
					"control.grant:success",
				);
			});
			session.send({ type: "abort" });
			await session.until(
				"agent_end after the abort",
				() => session.agentEnds() >= 1,
			);
			await session.until("control.revoke after the abort", () =>
				auditActions(session.sandbox.root).includes("control.revoke:success"),
			);
			session.send({
				type: "prompt",
				message: "control QA: raise after the interrupt",
			});
			await session.until(
				"the second agent_end",
				() => session.agentEnds() >= 2,
			);
		},
		verify: ({ audits, results }) => [
			[
				"the engine audited control.grant",
				audits.includes("control.grant:success"),
			],
			[
				"the interrupt revoked the grant",
				audits.includes("control.revoke:success"),
			],
			["no raise reached the engine", !audits.includes("raiseWindow:success")],
			[
				"the raise after the interrupt was refused COMPUTER_CONTROL_REQUIRED",
				results.at(-1)?.includes("COMPUTER_CONTROL_REQUIRED") === true,
			],
			[
				"the engine audited the refused raise",
				audits.includes("raiseWindow:error"),
			],
		],
	},
	declined: {
		steps: [run(`${acquire} ${raiseCode}`), { type: "text", text: "done" }],
		async drive(session) {
			const answer = answerConfirms(session, false);
			session.send({
				type: "prompt",
				message: "control QA: declined then raise",
			});
			await session.until("agent_end", () => {
				answer();
				return session.agentEnds() >= 1;
			});
		},
		verify: ({ audits, results, confirms }) => [
			[
				"the control confirm reached the client",
				confirms.includes(CONFIRM_TITLE),
			],
			[
				"the engine never saw control.grant",
				!audits.includes("control.grant:success"),
			],
			[
				"the engine audited the refused raise",
				audits.includes("raiseWindow:error"),
			],
			["no raise reached the engine", !audits.includes("raiseWindow:success")],
			[
				"the raise was refused COMPUTER_CONTROL_REQUIRED",
				results[0]?.includes("COMPUTER_CONTROL_REQUIRED") === true,
			],
		],
	},
};
