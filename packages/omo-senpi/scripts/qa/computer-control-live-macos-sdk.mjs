// SDK-lane scenarios of computer-control-live-macos.mjs (plan row 34). They drive the REAL engine through the
// desktop SDK over a spawn transport the driver launches itself (a DesktopService child opened with
// `reportMode: "object"` and `macosKeyPriming: "on"`), because the omo tool still opens null-mode sessions until
// plan row 36 and SDK attach over XPC is not built (the XPC peer policy accepts only the two signed role binaries).
//
//   chrome-two-window-typing  two Google Chrome windows on data: pages with one textarea each, A key. Types into
//                             B's page in the background three times. Passes when A's textarea value (read
//                             through AX) is unchanged, B's holds every piece, and A is Chrome's key window again.
//   dense-window-observe      a Safari page of `--dense-rows` list rows (default 2,000, >= 5,000 AX nodes). An
//                             `ax.snapshot` at the 3,000 ms default deadline (no node cap) returns complete:false
//                             with cuts and the deadline line; a drill on its smallest cut completes; the default
//                             depth-3 skeleton stays within the 2,000-token budget (conservative estimate, bytes / 3);
//                             the SDK's `window.ax` hands out a partial snapshot. The measurements go to the engine
//                             without the SDK's reply validation, so they stay engine facts. The control: the same
//                             window with a 10,000 ms deadline returns complete:true and observes >= 5,000 nodes,
//                             which is also the proof the page is dense enough (`--dense-rows` calibrates it).
//
// Both import the SDK and the service lazily, so `--list` and the senpi-driven scenarios never load them.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DENSE_MIN_NODES = 5_000;
const OBSERVE_DEADLINE_MS = 3_000;
const CONTROL_DEADLINE_MS = 10_000;
// The engine measures its deadline from the request; the reply, the capture and the pipe add to the wall time.
const TRANSPORT_SLACK_MS = 500;
const SKELETON_TOKEN_BUDGET = 2_000;
const NO_NODE_CAP = 1_000_000;
const PIECES = ["-qa1", "-qa2", "-qa3"];

const sha = (text) => createHash("sha256").update(text).digest("hex");
const pause = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

function osascript(script) {
	return new Promise((resolveRun) => {
		const child = spawn("osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.stderr.on("data", (chunk) => {
			err += chunk;
		});
		child.on("exit", (code) => resolveRun({ code, out: out.replace(/\n$/, ""), err: err.trim() }));
	});
}

/** An SDK computer over a fresh engine child; `close` ends both. */
async function openComputer(enginePath) {
	const [{ DesktopService, engineChildFactory }, { connect }, { defaultStopHotkey }] = await Promise.all([
		import("@oh-my-opencode/senpi-desktop-service"),
		import("@oh-my-opencode/senpi-desktop-sdk"),
		import("@oh-my-opencode/senpi-desktop-tool"),
	]);
	const service = new DesktopService({ createChild: engineChildFactory(enginePath), fullAccess: () => true });
	const capabilities = await service.open({ reportMode: "object", macosKeyPriming: "on" });
	await service.ensureStopPath(defaultStopHotkey());
	const port = {
		call: (method, params, options) => service.call(method, params, options ?? {}),
		notifications: { subscribe: () => () => undefined },
		close: () => service.close(),
	};
	const computer = await connect({ kind: "spawn", launch: async () => port });
	// `call` reaches the engine without the SDK's reply validation: the measurements stay engine facts.
	return { computer, capabilities, call: port.call };
}

async function waitForWindow(computer, filter, timeoutMs) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const [window] = await computer.windows(filter);
		if (window !== undefined) return window;
		await pause(250);
	}
	throw new Error(`no window matched ${JSON.stringify(filter)} within ${timeoutMs} ms`);
}

const reportSummary = (report) => ({
	disposition: report.disposition,
	delivered: report.delivered,
	effect: report.effect,
	route: report.route,
	focusRestoration: report.focusRestoration,
	timings: report.timings,
	legacy: report.legacy,
});

const errorSummary = (caught) => ({
	code: caught?.code ?? null,
	message: String(caught?.message ?? caught),
	data: caught?.data ?? null,
});

// --- chrome-two-window-typing ---------------------------------------------------------------------------------

const chromeTag = `omo-qa-chrome-${process.pid}`;
const chromeTitle = (name) => `${chromeTag}-${name}`;
const chromePage = (name, text) =>
	`data:text/html,${encodeURIComponent(
		`<!doctype html><title>${chromeTitle(name)}</title><textarea autofocus aria-label="qa-${name}" rows="6" cols="40">${text}</textarea>`,
	)}`;
const ORIGINAL = { A: "alpha original", B: "bravo original" };

async function chromeKeyWindowTitle() {
	return (await osascript('tell application "Google Chrome" to get title of window 1')).out;
}

async function textareaValue(window) {
	const [field] = await window.find({ role: "textarea" });
	if (field === undefined) return { element: undefined, value: undefined };
	return { element: field, value: (await field.read()).value ?? "" };
}

async function chromeTwoWindowTyping({ enginePath }) {
	const opened = [];
	for (const name of ["B", "A"]) {
		// A opens last, so it is Chrome's key window.
		const made = await osascript(
			`tell application "Google Chrome"\nset w to make new window\nset URL of active tab of w to "${chromePage(name, ORIGINAL[name])}"\nend tell`,
		);
		opened.push({ name, code: made.code, err: made.err });
		await pause(1500);
	}
	const evidence = { tag: chromeTag, opened };
	const timings = {};
	let session;
	try {
		if (opened.some((entry) => entry.code !== 0)) {
			return { evidence, checks: [["Google Chrome opened both windows (osascript exit 0)", false]] };
		}
		const started = Date.now();
		session = await openComputer(enginePath);
		timings.openMs = Date.now() - started;
		evidence.backgroundWindowInput = session.capabilities?.backgroundWindowInput ?? null;
		const { computer } = session;
		const windowA = await waitForWindow(computer, { app: "Chrome", title: chromeTitle("A") }, 15_000);
		const windowB = await waitForWindow(computer, { app: "Chrome", title: chromeTitle("B") }, 15_000);
		const beforeKey = await chromeKeyWindowTitle();
		const beforeA = await textareaValue(windowA);
		const beforeB = await textareaValue(windowB);
		const calls = [];
		for (const piece of PIECES) {
			const callStarted = Date.now();
			try {
				const report = await windowB.keyboard.type(piece);
				calls.push({ piece, ok: true, ms: Date.now() - callStarted, report: reportSummary(report) });
			} catch (caught) {
				calls.push({ piece, ok: false, ms: Date.now() - callStarted, error: errorSummary(caught) });
			}
		}
		await pause(500);
		const afterA = await textareaValue(windowA);
		const afterB = await textareaValue(windowB);
		const afterKey = await chromeKeyWindowTitle();
		Object.assign(evidence, {
			beforeKey,
			afterKey,
			a: { before: beforeA.value, after: afterA.value, beforeSha: sha(beforeA.value ?? ""), afterSha: sha(afterA.value ?? "") },
			b: { before: beforeB.value, after: afterB.value, afterSha: sha(afterB.value ?? "") },
			calls,
		});
		timings.typeMs = calls.map((call) => call.ms);
		const typed = PIECES.join("");
		return {
			evidence: { ...evidence, timings },
			checks: [
				["the engine reports background window input", evidence.backgroundWindowInput === true],
				["both textareas were found through AX", [beforeA, beforeB, afterA, afterB].every((read) => read.element !== undefined)],
				["A was Chrome's key window before typing", beforeKey === chromeTitle("A")],
				["every background type call succeeded with an object report", calls.length === PIECES.length && calls.every((call) => call.ok && call.report.legacy === false)],
				[`A's page text unchanged (sha256 ${evidence.a.beforeSha} -> ${evidence.a.afterSha})`, afterA.value === beforeA.value && beforeA.value === ORIGINAL.A],
				[`B's page text is its original plus every piece (sha256 ${evidence.b.afterSha})`, afterB.value?.includes(typed) === true && afterB.value.replace(typed, "") === ORIGINAL.B],
				["A is Chrome's key window again after hand-back", afterKey === chromeTitle("A")],
			],
		};
	} finally {
		await session?.computer.close().catch(() => undefined);
		await osascript(`tell application "Google Chrome" to close (every window whose title contains "${chromeTag}")`);
	}
}

// --- dense-window-observe -------------------------------------------------------------------------------------

const denseTag = `omo-qa-dense-${process.pid}`;

function densePage(rows) {
	const items = Array.from(
		{ length: rows },
		(_, index) => `<li><button>Row ${index}</button> <span>item ${index}</span> <a href="#r${index}">link ${index}</a></li>`,
	);
	return `<!doctype html><title>${denseTag}</title><h1>${denseTag}</h1><ul>${items.join("")}</ul>`;
}

const snapshotSummary = (snapshot) => ({
	complete: snapshot.complete,
	nodeCount: snapshot.nodeCount,
	nodesObserved: snapshot.nodesObserved,
	truncated: snapshot.truncated,
	generation: snapshot.generation,
	parent: snapshot.parent,
	cuts: (snapshot.cuts ?? []).length,
	textBytes: Buffer.byteLength(snapshot.text),
	textSha256: sha(snapshot.text),
	tail: snapshot.text.split("\n").slice(-3),
});

async function timed(run) {
	const started = Date.now();
	const value = await run();
	return { value, ms: Date.now() - started };
}

async function denseWindowObserve({ enginePath, denseRows }) {
	const dir = join(homedir(), "Library", "Caches", denseTag);
	mkdirSync(dir, { recursive: true });
	const page = join(dir, "dense.html");
	writeFileSync(page, densePage(denseRows));
	spawn("open", ["-g", "-a", "Safari", page]);
	const evidence = { tag: denseTag, rows: denseRows, pageSha256: sha(densePage(denseRows)) };
	let session;
	try {
		session = await openComputer(enginePath);
		const window = await waitForWindow(session.computer, { app: "Safari", title: denseTag }, 20_000);
		const snapshot = (opts) => session.call("ax.snapshot", { target: window.id, opts });
		// Let WebKit build the page's AX tree before the timed reads.
		await pause(3000);
		const control = await timed(() => snapshot({ timeoutMs: CONTROL_DEADLINE_MS, maxNodes: NO_NODE_CAP, all: true }));
		// The default deadline: no timeoutMs, and no node cap, so only the deadline can cut the walk.
		const observed = await timed(() => snapshot({ maxNodes: NO_NODE_CAP }));
		const partial = observed.value;
		const smallest = [...(partial.cuts ?? [])].sort((left, right) => left.childCount - right.childCount)[0];
		let drill;
		if (smallest !== undefined) {
			try {
				drill = await timed(() => snapshot({ root: smallest.ref, maxNodes: NO_NODE_CAP }));
			} catch (caught) {
				drill = { error: errorSummary(caught) };
			}
		}
		// The skeleton a caller gets by default: depth 3, the engine's own node budget and deadline.
		const skeleton = await timed(() => snapshot({ skeleton: true }));
		const skeletonBytes = Buffer.byteLength(skeleton.value.text);
		const skeletonTokens = Math.ceil(skeletonBytes / 3);
		// The SDK consumer path: a node-budget-cut snapshot is partial too, and window.ax must hand it out.
		let sdkPartial;
		try {
			const parsed = await window.ax({ maxNodes: 2 });
			sdkPartial = { complete: parsed.complete, cuts: parsed.cuts.length };
		} catch (caught) {
			sdkPartial = { error: errorSummary(caught) };
		}
		Object.assign(evidence, {
			control: { ms: control.ms, ...snapshotSummary(control.value) },
			observe: { ms: observed.ms, ...snapshotSummary(partial) },
			drill:
				drill === undefined
					? null
					: drill.error !== undefined
						? { cut: smallest, error: drill.error }
						: { cut: smallest, ms: drill.ms, ...snapshotSummary(drill.value) },
			skeleton: {
				ms: skeleton.ms,
				...snapshotSummary(skeleton.value),
				tokenEstimate: skeletonTokens,
				tokenMethod: "ceil(utf8 bytes / 3), conservative; the DESIGN section 9 max_tokens=1 count is taken off-host from this text",
				text: skeleton.value.text,
			},
			sdkPartial,
		});
		const drilled = drill?.value;
		return {
			evidence,
			checks: [
				["the session is in object mode (snapshots carry a generation)", typeof partial.generation === "number"],
				[`control: a ${CONTROL_DEADLINE_MS} ms deadline returns complete:true (${control.ms} ms)`, control.value.complete === true],
				[`the page has >= ${DENSE_MIN_NODES} AX nodes (control observed ${control.value.nodesObserved})`, (control.value.nodesObserved ?? 0) >= DENSE_MIN_NODES],
				[`the default-deadline snapshot returned within ${OBSERVE_DEADLINE_MS} ms (+${TRANSPORT_SLACK_MS} ms transport; ${observed.ms} ms)`, observed.ms <= OBSERVE_DEADLINE_MS + TRANSPORT_SLACK_MS],
				["it is complete:false with cuts", partial.complete === false && (partial.cuts ?? []).length > 0],
				["the cut was the deadline, not a node budget", partial.text.includes(`deadline ${OBSERVE_DEADLINE_MS} ms reached`)],
				[
					`a drill on the smallest cut completes under that snapshot's generation (${smallest?.ref ?? "none"}, ${smallest?.childCount ?? 0} children)`,
					drilled !== undefined && drilled.complete === true && drilled.parent === partial.generation && drilled.nodeCount > 0,
				],
				[`the depth-3 skeleton fits ${SKELETON_TOKEN_BUDGET} tokens (estimate ${skeletonTokens}, ${skeletonBytes} bytes)`, skeletonTokens <= SKELETON_TOKEN_BUDGET],
				["the SDK hands out a partial snapshot (window.ax)", sdkPartial.error === undefined && sdkPartial.complete === false],
			],
		};
	} finally {
		await session?.computer.close().catch(() => undefined);
		await osascript(`tell application "Safari" to close (every window whose name contains "${denseTag}")`);
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Each runs on its own engine child and returns `{ evidence, checks }`; a throw is the scenario's error. */
export const sdkScenarios = {
	"chrome-two-window-typing": chromeTwoWindowTyping,
	"dense-window-observe": denseWindowObserve,
};
