// Desktop and display input scenarios for computer-control-live-macos.mjs (#10788). Input on the desktop or a
// display lands on the user's real pointer, so outside full access it needs the foreground-control grant. The
// click aims at the OK button of the driver's own dialog, so an admitted click is observed by the dialog itself
// (`button returned:OK`); a refused click must leave the dialog open.
import { CONFIRM_TITLE, REASON, TARGET_TITLE } from "./computer-control-live-macos-scenarios.mjs";

const run = (code) => ({ type: "tool_call", name: "computer", arguments: { action: "run", code } });
const acquire = `const state = await desktop.control.acquire({ reason: ${JSON.stringify(REASON)} });`;

// Finds the dialog's OK button through the engine's own accessibility tree (a read), maps its center into the
// "all" composite capture and clicks it there. The run refuses to click when the capture and the display
// rectangles disagree, so a mapping mistake never clicks anywhere else.
const clickButton = `
const dialog = await desktop.window({ title: ${JSON.stringify(TARGET_TITLE)} });
const [ok] = (await dialog.find({ role: "button", title: "OK" }));
if (ok === undefined) throw new Error("QA: no OK button in the target dialog");
const b = await ok.bounds();
const x = b.x + b.width / 2, y = b.y + b.height / 2;
const all = await desktop.display("all");
const shot = await all.screenshot();
const displays = await desktop.displays();
const d = displays.find((d) => x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height);
const composite = Math.max(...displays.map((d) => d.pixelX + d.pixelWidth));
if (d === undefined || composite !== shot.width) throw new Error("QA: refusing to click, frame mismatch " + composite + " vs " + shot.width);
await all.click(d.pixelX + (x - d.x) * d.pixelWidth / d.width, d.pixelY + (y - d.y) * d.pixelHeight / d.height);
`;

const refusedClick = `await desktop.screenshot(); await desktop.click(5, 5); return "clicked"`;

function answerConfirms(session, answer) {
	const answered = new Set();
	return () => {
		for (const event of session.events) {
			if (event.type === "extension_ui_request" && event.method === "confirm" && !answered.has(event.id)) {
				answered.add(event.id);
				session.send({ type: "extension_ui_response", id: event.id, confirmed: answer });
			}
		}
		return false;
	};
}

const promptOnce = (message, answer) => async (session) => {
	const answering = answer === undefined ? () => false : answerConfirms(session, answer);
	session.send({ type: "prompt", message });
	await session.until("agent_end", () => {
		answering();
		return session.agentEnds() >= 1;
	});
};

export const desktopScenarios = {
	"desktop-refused-without-grant": {
		preset: "ask",
		steps: () => [run(refusedClick), { type: "text", text: "done" }],
		drive: promptOnce("control QA: desktop click without a grant"),
		verify: ({ audits, results, confirms, target }) => [
			["the desktop click was refused COMPUTER_CONTROL_REQUIRED", results[0]?.includes("COMPUTER_CONTROL_REQUIRED") === true],
			["the engine audited the refused click", audits.includes("click:error")],
			["no click reached the engine", !audits.includes("click:success")],
			["no confirm was shown without an acquire", confirms.length === 0],
			["the target dialog stayed open", target.open],
		],
	},
	"display-click-after-approval": {
		preset: "ask",
		steps: () => [run(`${acquire} ${clickButton} return JSON.stringify(state)`), { type: "text", text: "done" }],
		drive: promptOnce("control QA: approve, then click on the display", true),
		verify: ({ audits, results, confirms, target }) => [
			["the human was asked", confirms.includes(CONFIRM_TITLE)],
			["the run reported an active grant", results[0]?.includes('"active":true') === true],
			[
				"the engine audited control.grant, then the click",
				audits.indexOf("control.grant:success") !== -1 && audits.indexOf("click:success") > audits.indexOf("control.grant:success"),
			],
			["the dialog saw the click on its OK button", target.reply.includes("button returned:OK")],
		],
	},
	"full-access-click-without-prompt": {
		preset: "full-access",
		steps: () => [run(`${clickButton} return "clicked"`), { type: "text", text: "done" }],
		drive: promptOnce("control QA: full access clicks the display"),
		verify: ({ audits, results, confirms, target }) => [
			["no confirm was shown", confirms.length === 0],
			["the run finished", results[0]?.includes("clicked") === true],
			[
				"the host granted without asking, before the click",
				audits.indexOf("control.grant:success") !== -1 && audits.indexOf("click:success") > audits.indexOf("control.grant:success"),
			],
			["no refusal reached the audit", !audits.includes("click:error")],
			["the dialog saw the click on its OK button", target.reply.includes("button returned:OK")],
		],
	},
	"full-access-headless-click": {
		preset: "full-access",
		print: "control QA: headless full access clicks the display",
		steps: () => [run(`${clickButton} return "clicked"`), { type: "text", text: "done" }],
		verify: ({ audits, results, target }) => [
			["the headless run finished", results[0]?.includes("clicked") === true],
			[
				"the host granted without a UI, before the click",
				audits.indexOf("control.grant:success") !== -1 && audits.indexOf("click:success") > audits.indexOf("control.grant:success"),
			],
			["the dialog saw the click on its OK button", target.reply.includes("button returned:OK")],
		],
	},
};
