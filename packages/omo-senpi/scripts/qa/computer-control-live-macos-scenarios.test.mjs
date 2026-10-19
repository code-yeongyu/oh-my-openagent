import { describe, expect, test } from "bun:test";

import {
	CONFIRM_TITLE,
	scenarios,
} from "./computer-control-live-macos-scenarios.mjs";

const REFUSED =
	'{"code":"COMPUTER_CONTROL_REQUIRED","message":"COMPUTER_CONTROL_REQUIRED: ..."}';
const failed = (scenario, outcome) =>
	scenarios[scenario]
		.verify(outcome)
		.filter(([, ok]) => !ok)
		.map(([label]) => label);

// What the live macOS run recorded for each refusal scenario (#10446 QA).
const live = {
	interrupted: {
		audits: [
			"control.grant:success",
			"control.revoke:success",
			"raiseWindow:error",
		],
		results: ["Tool execution aborted", REFUSED],
		confirms: [CONFIRM_TITLE],
	},
	declined: {
		audits: ["raiseWindow:error"],
		results: [REFUSED],
		confirms: [CONFIRM_TITLE],
	},
};

describe("refusal scenarios check the engine audit, not only the text", () => {
	test("#given the live outcomes #then every check passes", () => {
		expect(failed("interrupted", live.interrupted)).toEqual([]);
		expect(failed("declined", live.declined)).toEqual([]);
	});

	test("#given a refusal that became a no-op (no raise reached the engine) #then each scenario fails", () => {
		expect(
			failed("interrupted", {
				...live.interrupted,
				audits: ["control.grant:success", "control.revoke:success"],
			}),
		).toEqual(["the engine audited the refused raise"]);
		expect(failed("declined", { ...live.declined, audits: [] })).toEqual([
			"the engine audited the refused raise",
		]);
	});

	test("#given a declined run whose confirm never reached the client #then it fails", () => {
		expect(failed("declined", { ...live.declined, confirms: [] })).toEqual([
			"the control confirm reached the client",
		]);
	});
});

describe("the driver answers only the control confirm", () => {
	test("#given another confirm prompt #then it is left unanswered", () => {
		const sent = [];
		const session = {
			events: [
				{
					type: "extension_ui_request",
					method: "confirm",
					id: "a",
					title: "Allow bash?",
				},
				{
					type: "extension_ui_request",
					method: "confirm",
					id: "b",
					title: CONFIRM_TITLE,
				},
			],
			send: (message) => sent.push(message),
			agentEnds: () => 1,
			until: async (_description, predicate) => {
				predicate();
			},
		};

		return scenarios.declined.drive(session).then(() => {
			expect(
				sent.filter((message) => message.type === "extension_ui_response"),
			).toEqual([{ type: "extension_ui_response", id: "b", confirmed: false }]);
		});
	});
});
