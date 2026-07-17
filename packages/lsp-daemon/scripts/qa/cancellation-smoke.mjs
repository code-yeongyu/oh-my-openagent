// allow: SIZE_OK - one deterministic socket-to-LSP cancellation scenario keeps request identity and cleanup evidence together.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

const [repositoryRoot] = process.argv.slice(2);
if (!repositoryRoot) throw new Error("repository root argument is required");
const root = realpathSync(repositoryRoot);

const { callToolViaDaemon } = await import(pathToFileURL(join(root, "packages/lsp-daemon/src/daemon-client.ts")).href);
const { daemonPaths: resolveDaemonPaths, OMO_LSP_DAEMON_DIR } = await import(
	pathToFileURL(join(root, "packages/lsp-daemon/src/paths.ts")).href
);
const { handleDaemonMessage } = await import(pathToFileURL(join(root, "packages/lsp-daemon/src/request-routing.ts")).href);
const { createLineDecoder, encodeJsonLine } = await import(
	pathToFileURL(join(root, "packages/lsp-daemon/src/socket-jsonrpc.ts")).href
);
const { JsonRpcConnection } = await import(
	pathToFileURL(join(root, "packages/lsp-core/src/lsp/json-rpc-connection.ts")).href
);
const { disposeDefaultLspManager } = await import(pathToFileURL(join(root, "packages/lsp-core/src/lsp/manager.ts")).href);

const tempRoot = mkdtempSync(join(tmpdir(), "lsp-cancel-smoke-"));
const daemonMessages = [];
const activeRequests = new Map();
const sockets = new Set();
let daemonServer;
let summary;

try {
	const paths = resolveDaemonPaths(
		{ [OMO_LSP_DAEMON_DIR]: join(tempRoot, "daemon") },
		{ version: "manual", cliPath: join(root, "packages/lsp-daemon/src/cli.ts") },
	);
	mkdirSync(paths.dir, { recursive: true });
	const token = "manual-smoke-token";
	writeFileSync(paths.auth, `${token}\n`, { mode: 0o600 });

	const workspace = join(tempRoot, "workspace");
	mkdirSync(workspace);
	const canonicalWorkspace = realpathSync(workspace);
	writeFileSync(join(workspace, "package.json"), "{}\n");
	const source = join(workspace, "source.ts");
	writeFileSync(source, "const value: number = 1;\n");

	const lspEvents = join(tempRoot, "lsp-events.jsonl");
	const fakeServer = join(tempRoot, "fake-lsp-server.mjs");
	writeFileSync(fakeServer, fakeLspServerSource(), "utf-8");
	writeFileSync(lspEvents, "", "utf-8");
	const userConfigPath = join(tempRoot, "user-lsp.json");
	writeFileSync(
		userConfigPath,
		JSON.stringify({
			lsp: {
				manual: {
					command: [process.env.NODE_BINARY ?? "node", fakeServer, lspEvents],
					extensions: [".ts"],
					priority: 100,
				},
			},
		}),
	);

	daemonServer = createServer((socket) => {
		sockets.add(socket);
		const decoder = createLineDecoder((message) => {
			daemonMessages.push(redactAuth(message));
			void handleDaemonMessage(message, {
				token,
				owner: {
					pid: process.pid,
					nonce: "manual-smoke",
					startedAt: new Date(0).toISOString(),
					endpoint: { kind: "missing", path: "manual" },
				},
				activeRequests,
			}).then((response) => {
				daemonMessages.push({ direction: "response", response });
				if (response && socket.writable) socket.write(encodeJsonLine(response));
			});
		});
		socket.on("data", (chunk) => decoder.push(chunk));
		socket.on("close", () => {
			for (const controller of activeRequests.values()) controller.abort();
			activeRequests.clear();
			sockets.delete(socket);
		});
	});
	await listen(daemonServer, paths.socket);

	const controller = new AbortController();
	const resultPromise = callToolViaDaemon(
		"diagnostics",
		{ filePath: source, severity: "error" },
		{
			paths,
			ensure: async () => {},
			requestTimeoutMs: 5_000,
			signal: controller.signal,
			context: {
				cwd: canonicalWorkspace,
				projectConfigPaths: [join(canonicalWorkspace, ".codex", "lsp-client.json")],
				userConfigPath,
				installDecisionsPath: join(tempRoot, "install-decisions.json"),
				capabilities: { installDecisionTool: false },
			},
		},
	);

	const first = await Promise.race([
		waitForEvent(lspEvents, (event) => event.type === "clientRequest" && event.method === "textDocument/diagnostic").then(
			(event) => ({ kind: "lsp-request", event }),
		),
		resultPromise.then((result) => ({ kind: "daemon-result", result })),
	]);
	if (first.kind !== "lsp-request") {
		throw new Error(
			`Daemon call completed before fake LSP diagnostic request: ${JSON.stringify({
				result: first.result,
				daemonMessages,
				lspEvents: readEvents(lspEvents),
			})}`,
		);
	}
	const lspRequest = first.event;
	controller.abort(new Error("manual caller abort"));
	const result = await resultPromise;
	const lspCancel = await waitForEvent(
		lspEvents,
		(event) => event.type === "clientNotification" && event.method === "$/cancelRequest",
	);
	const lateResponse = await waitForEvent(
		lspEvents,
		(event) => event.type === "serverLateResponse" && event.id === lspRequest.id,
	);
	await waitUntil(() => activeRequests.size === 0, "daemon active request cleanup");

	const daemonRequest = daemonMessages.find((message) => message.method === "tools/call");
	const daemonCancel = daemonMessages.find((message) => message.method === "$/cancelRequest");
	assert(daemonRequest?.id !== undefined, "daemon request id missing");
	assert(daemonCancel?.params?.id === daemonRequest.id, "daemon cancel id did not match proxy request id");
	assert(lspCancel.params?.id === lspRequest.id, "LSP cancel id did not match LSP request id");
	assert(result.isError === true, "daemon call did not report cancellation as an error result");
	assert(activeRequests.size === 0, "daemon active request map leaked");

	const direct = await directJsonRpcCancellationCheck();
	const daemonEndpointKind = paths.socket.startsWith("\\\\.\\pipe\\") ? "named-pipe" : "unix-socket";
	assert(
		daemonEndpointKind === (process.platform === "win32" ? "named-pipe" : "unix-socket"),
		`production daemon endpoint kind did not match ${process.platform}`,
	);
	summary = {
		workspaceHash: sha256(readFileSync(source)),
		daemonEndpointKind,
		daemonProxyId: daemonRequest.id,
		daemonCancelTarget: daemonCancel.params.id,
		lspRequestId: lspRequest.id,
		lspCancelTarget: lspCancel.params.id,
		lateResponseIgnoredProbe: lateResponse.id,
		daemonActiveRequestsAfter: activeRequests.size,
		directPendingAfterLateResponse: direct.pendingAfterLateResponse,
		resultText: result.content[0]?.text ?? "",
		auth: "redacted",
	};
} finally {
	for (const socket of sockets) socket.destroy();
	if (daemonServer) await closeServer(daemonServer);
	await disposeDefaultLspManager();
	rmSync(tempRoot, { recursive: true, force: true });
}
assert(summary, "cancellation summary missing after cleanup");
await new Promise((resolve, reject) => {
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`, (error) => {
		if (error) reject(error);
		else resolve();
	});
});
process.exit(0);

function fakeLspServerSource() {
	return String.raw`
import { appendFileSync } from "node:fs";

const [, , eventsPath] = process.argv;
let buffer = Buffer.alloc(0);
let pendingDiagnosticId = null;

function record(event) {
	appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf-8");
}

function send(message) {
	const body = Buffer.from(JSON.stringify(message), "utf-8");
	process.stdout.write("Content-Length: " + body.length + "\r\n\r\n");
	process.stdout.write(body);
}

function handle(message) {
	if (Object.hasOwn(message, "id")) {
		record({ type: "clientRequest", method: message.method, id: message.id });
		if (message.method === "initialize") {
			send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { diagnosticProvider: {} } } });
			return;
		}
		if (message.method === "textDocument/diagnostic") {
			pendingDiagnosticId = message.id;
			return;
		}
		send({ jsonrpc: "2.0", id: message.id, result: null });
		return;
	}
	record({ type: "clientNotification", method: message.method, params: message.params ?? null });
	if (message.method === "$/cancelRequest" && pendingDiagnosticId !== null) {
		const id = pendingDiagnosticId;
		setTimeout(() => {
			record({ type: "serverLateResponse", id });
			send({ jsonrpc: "2.0", id, result: { items: [] } });
		}, 20);
	}
	if (message.method === "exit") process.exit(0);
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
		handle(JSON.parse(body));
	}
});
`;
}

async function directJsonRpcCancellationCheck() {
	const serverToClient = new PassThrough();
	const clientToServer = new PassThrough();
	const connection = new JsonRpcConnection(serverToClient, clientToServer);
	const messages = [];
	const decoder = createContentLengthDecoder((message) => messages.push(message));
	clientToServer.on("data", (chunk) => decoder.push(chunk));
	connection.listen();
	const controller = new AbortController();
	const request = connection.sendRequest("manual/slow", {}, { signal: controller.signal }).catch((error) => error);
	await waitUntil(() => messages.some((message) => message.method === "manual/slow"), "direct JSON-RPC request");
	const requestMessage = messages.find((message) => message.method === "manual/slow");
	controller.abort(new Error("direct manual cancel"));
	await request;
	await waitUntil(() => messages.some((message) => message.method === "$/cancelRequest"), "direct JSON-RPC cancel");
	serverToClient.write(encodeContentLength({ jsonrpc: "2.0", id: requestMessage.id, result: "late" }));
	await new Promise((resolve) => setTimeout(resolve, 10));
	const pendingAfterLateResponse = connection.pendingRequestCount();
	connection.dispose();
	return { pendingAfterLateResponse };
}

function createContentLengthDecoder(onMessage) {
	let buffer = Buffer.alloc(0);
	return {
		push(chunk) {
			buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
			for (;;) {
				const headerEnd = buffer.indexOf("\r\n\r\n");
				if (headerEnd === -1) return;
				const match = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("ascii"));
				if (!match) throw new Error("missing content-length");
				const length = Number(match[1]);
				const bodyStart = headerEnd + 4;
				if (buffer.length < bodyStart + length) return;
				const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf-8");
				buffer = buffer.subarray(bodyStart + length);
				onMessage(JSON.parse(body));
			}
		},
	};
}

function encodeContentLength(message) {
	const body = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`;
}

function redactAuth(message) {
	const cloned = structuredClone(message);
	if (cloned?.params?._omo?.token) cloned.params._omo.token = "redacted";
	return cloned;
}

function waitForEvent(path, predicate) {
	return waitUntil(() => readEvents(path).find(predicate), `event in ${path}`);
}

async function waitUntil(fn, label) {
	const deadline = Date.now() + 3_000;
	for (;;) {
		const value = fn();
		if (value) return value;
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function readEvents(path) {
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

function listen(server, path) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function closeServer(server) {
	return new Promise((resolve) => server.close(() => resolve()));
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}
