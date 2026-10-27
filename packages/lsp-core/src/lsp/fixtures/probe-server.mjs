// Minimal stdio LSP server for server-probe tests. Mode (argv[2]):
//   ok               answers initialize and documentSymbol
//   exit             exits with code 3 before reading anything
//   hang-initialize  never answers initialize
//   symbol-error     answers initialize, fails documentSymbol
//   empty-symbols    answers documentSymbol with no symbols
//   late-symbols     answers the first documentSymbol with no symbols, later ones with one
const mode = process.argv[2] ?? "ok";

if (mode === "exit") {
	process.stderr.write("probe-server: refusing to start\n");
	process.exit(3);
}

let buffer = Buffer.alloc(0);
let symbolRequests = 0;
// Like yaml-language-server, symbols exist only for a document opened under the exact URI asked about.
const openedUris = new Set();

function send(message) {
	const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf-8");
	process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
	process.stdout.write(body);
}

function handle(message) {
	if (message.method === "initialize") {
		if (mode === "hang-initialize") return;
		send({ id: message.id, result: { capabilities: { documentSymbolProvider: true } } });
		return;
	}
	if (message.method === "textDocument/documentSymbol") {
		if (mode === "symbol-error") {
			send({ id: message.id, error: { code: -32603, message: "symbol provider crashed" } });
			return;
		}
		symbolRequests += 1;
		const unopened = !openedUris.has(message.params?.textDocument?.uri);
		if (unopened || mode === "empty-symbols" || (mode === "late-symbols" && symbolRequests === 1)) {
			send({ id: message.id, result: [] });
			return;
		}
		const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
		send({ id: message.id, result: [{ name: "probe", kind: 12, range, selectionRange: range }] });
		return;
	}
	if (message.method === "textDocument/didOpen") {
		openedUris.add(message.params?.textDocument?.uri);
		return;
	}
	if (message.method === "shutdown") {
		send({ id: message.id, result: null });
		return;
	}
	if (message.method === "exit") process.exit(0);
}

process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	for (;;) {
		const headerEnd = buffer.indexOf("\r\n\r\n");
		if (headerEnd === -1) return;
		const match = /Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString("utf-8"));
		if (!match) return;
		const length = Number(match[1]);
		const start = headerEnd + 4;
		if (buffer.length < start + length) return;
		const body = buffer.subarray(start, start + length).toString("utf-8");
		buffer = buffer.subarray(start + length);
		handle(JSON.parse(body));
	}
});
