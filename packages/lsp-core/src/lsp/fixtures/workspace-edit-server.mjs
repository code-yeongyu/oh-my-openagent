import { appendFileSync, readFileSync } from "node:fs";

const [, , scenarioPath, eventsPath] = process.argv;
const scenario = JSON.parse(readFileSync(scenarioPath, "utf-8"));

let buffer = Buffer.alloc(0);
let nextServerRequestId = 10_000;
let renameIndex = 0;
let diagnosticIndex = 0;
const pendingServerRequests = new Map();

function record(event) {
	appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf-8");
}

function send(message) {
	const body = Buffer.from(JSON.stringify(message), "utf-8");
	process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
	process.stdout.write(body);
}

function sendResponse(id, result) {
	send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
	send({ jsonrpc: "2.0", id, error: { code, message } });
}

function sendApplyEdit(edit, context) {
	const id = nextServerRequestId;
	nextServerRequestId += 1;
	pendingServerRequests.set(String(id), context);
	record({ type: "serverRequest", method: "workspace/applyEdit", id, edit });
	send({ jsonrpc: "2.0", id, method: "workspace/applyEdit", params: { edit } });
}

function renameResult(step) {
	if (step.renameResult === "same") return step.applyEdit ?? null;
	if (step.renameResult === "different") return step.differentEdit ?? null;
	if (step.renameResult === "edit") return step.renameEdit ?? null;
	return null;
}

function finishRename(context) {
	const result = renameResult(context.step);
	const delay = Number(context.step.responseDelayMs ?? 0);
	setTimeout(() => {
		record({ type: "serverResponse", method: "textDocument/rename", result });
		sendResponse(context.renameRequestId, result);
	}, delay);
}

function schedulePublish(step, fallbackUri, fallbackVersion) {
	const delay = Number(step.delayMs ?? 0);
	setTimeout(() => {
		const params = {
			uri: step.uri ?? fallbackUri,
			...(step.version === undefined ? {} : { version: step.version }),
			diagnostics: Array.isArray(step.diagnostics) ? step.diagnostics : [],
		};
		record({ type: "serverNotification", method: "textDocument/publishDiagnostics", params });
		send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params });
	}, delay);
}

function publishSteps(trigger) {
	if (!Array.isArray(scenario.publishDiagnostics)) return [];
	return scenario.publishDiagnostics.filter((step) => step?.trigger === trigger);
}

function applyPublishSteps(trigger, fallbackUri, fallbackVersion) {
	for (const step of publishSteps(trigger)) schedulePublish(step, fallbackUri, fallbackVersion);
}

function handleClientResponse(message) {
	const context = pendingServerRequests.get(String(message.id));
	if (!context) return;
	pendingServerRequests.delete(String(message.id));
	record({
		type: "clientResponse",
		method: "workspace/applyEdit",
		result: message.result ?? null,
		error: message.error ?? null,
	});
	if (context.kind === "unscoped") return;
	if (typeof context.pendingApplyResponses === "number") {
		context.pendingApplyResponses -= 1;
		if (context.pendingApplyResponses > 0) return;
		finishRename(context);
		return;
	}
	if (context.step.applyTwice === true && context.applyCount === 1) {
		sendApplyEdit(context.step.applyEdit, { ...context, applyCount: 2 });
		return;
	}
	finishRename(context);
}

function handleRequest(message) {
	if (message.method === "initialize") {
		record({ type: "clientRequest", method: message.method, id: message.id, params: message.params });
		sendResponse(message.id, { capabilities: scenario.capabilities ?? {} });
		return;
	}
	if (message.method === "textDocument/rename") {
		const step = scenario.renameSteps?.[renameIndex] ?? {};
		renameIndex += 1;
		record({ type: "clientRequest", method: message.method, id: message.id, params: message.params, renameIndex });
		if (step.applyEdit) {
			const context = { kind: "rename", renameRequestId: message.id, step, applyCount: 1 };
			if (step.applyConcurrently === true) {
				context.pendingApplyResponses = 2;
				sendApplyEdit(step.applyEdit, context);
				sendApplyEdit(step.applyEdit, context);
				return;
			}
			const delay = Number(step.applyDelayMs ?? 0);
			if (delay > 0) {
				setTimeout(() => sendApplyEdit(step.applyEdit, context), delay);
				return;
			}
			sendApplyEdit(step.applyEdit, context);
			return;
		}
		finishRename({ renameRequestId: message.id, step });
		return;
	}
	if (message.method === "textDocument/diagnostic") {
		record({ type: "clientRequest", method: message.method, id: message.id, params: message.params, diagnosticIndex: diagnosticIndex + 1 });
		applyPublishSteps("diagnosticRequest", message.params?.textDocument?.uri, undefined);
		const step = Array.isArray(scenario.diagnosticResponses) ? scenario.diagnosticResponses[diagnosticIndex] : undefined;
		diagnosticIndex += 1;
		if (step?.action === "hang") return;
		if (step?.action === "close") {
			const delay = Number(step.delayMs ?? 0);
			setTimeout(() => process.exit(0), delay);
			return;
		}
		const delay = Number(step?.delayMs ?? 0);
		setTimeout(() => {
			if (step?.error) {
				record({ type: "serverError", method: "textDocument/diagnostic", error: step.error });
				sendError(message.id, step.error.code, step.error.message);
				return;
			}
			const result = step?.report ?? { items: scenario.diagnostics ?? [] };
			record({ type: "serverResponse", method: "textDocument/diagnostic", result });
			sendResponse(message.id, result);
		}, delay);
		return;
	}
	if (message.method === "shutdown") {
		sendResponse(message.id, null);
		return;
	}
	sendResponse(message.id, null);
}

function handleNotification(message) {
	record({ type: "clientNotification", method: message.method, params: message.params ?? null });
	if (message.method === "initialized" && scenario.unscopedApplyEdit) {
		sendApplyEdit(scenario.unscopedApplyEdit, { kind: "unscoped" });
	}
	if (message.method === "initialized") {
		applyPublishSteps("initialized", undefined, undefined);
	}
	if (message.method === "textDocument/didOpen") {
		applyPublishSteps("didOpen", message.params.textDocument.uri, message.params.textDocument.version);
	}
	if (message.method === "textDocument/didChange" && Array.isArray(scenario.diagnostics)) {
		send({
			jsonrpc: "2.0",
			method: "textDocument/publishDiagnostics",
			params: {
				uri: message.params.textDocument.uri,
				version: message.params.textDocument.version,
				diagnostics: scenario.diagnostics,
			},
		});
	}
	if (message.method === "textDocument/didChange") {
		applyPublishSteps("didChange", message.params.textDocument.uri, message.params.textDocument.version);
	}
	if (message.method === "exit") process.exit(0);
}

function handleMessage(message) {
	if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
		handleClientResponse(message);
		return;
	}
	if (Object.hasOwn(message, "id")) {
		handleRequest(message);
		return;
	}
	handleNotification(message);
}

process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	for (;;) {
		const headerEnd = buffer.indexOf("\r\n\r\n");
		if (headerEnd === -1) return;
		const header = buffer.subarray(0, headerEnd).toString("ascii");
		const match = /content-length:\s*(\d+)/i.exec(header);
		if (!match) process.exit(2);
		const length = Number(match[1]);
		const bodyStart = headerEnd + 4;
		if (buffer.length < bodyStart + length) return;
		const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf-8");
		buffer = buffer.subarray(bodyStart + length);
		handleMessage(JSON.parse(body));
	}
});
