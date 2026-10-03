// Live tsgo 7.0.2 wire-shape probe for oh-my-openagent issue #7165.
// Scenario A reproduces the 4.19.4 client wire shape: `initialized` sent WITHOUT a params field.
// Scenario B reproduces the fixed wire shape: `initialized` sent WITH an empty object params.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL(".", import.meta.url).pathname;
const proj = join(root, "proj");
mkdirSync(proj, { recursive: true });
writeFileSync(join(proj, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler", noEmit: true }, include: ["*.ts"] }));
writeFileSync(join(proj, "clean.ts"), "export const answer = 42;\n");

function frame(message) {
	const body = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

async function runScenario(name, sendInitializedParams) {
	return await new Promise((resolve) => {
		const child = spawn(join(root, "node_modules", ".bin", "tsc"), ["--lsp", "--stdio"], {
			cwd: proj,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const events = [];
		let buffer = Buffer.alloc(0);
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			try { child.kill("SIGKILL"); } catch {}
			resolve({ name, ...result, events });
		};

		child.stdout.on("data", (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			for (;;) {
				const headerEnd = buffer.indexOf("\r\n\r\n");
				if (headerEnd === -1) return;
				const header = buffer.subarray(0, headerEnd).toString("ascii");
				const match = /content-length:\s*(\d+)/i.exec(header);
				if (!match?.[1]) return;
				const bodyStart = headerEnd + 4;
				const bodyEnd = bodyStart + Number.parseInt(match[1], 10);
				if (buffer.length < bodyEnd) return;
				let parsed;
				try { parsed = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8")); } catch { return; }
				buffer = buffer.subarray(bodyEnd);
				events.push(parsed);
				// Mirror OMO's LspClientTransport server-request responders.
				if (typeof parsed.id === "string" || typeof parsed.id === "number") {
					if (parsed.method === "workspace/configuration") {
						const items = Array.isArray(parsed.params?.items) ? parsed.params.items : [];
						const result = items.map((item) => (item?.section === "json" ? { validate: { enable: true } } : {}));
						child.stdin.write(frame({ jsonrpc: "2.0", id: parsed.id, result }));
					} else {
						child.stdin.write(frame({ jsonrpc: "2.0", id: parsed.id, result: null }));
					}
				}
				if (parsed.id === 2) {
					if ("error" in parsed) {
						finish({ outcome: "request-error", code: parsed.error.code, message: parsed.error.message });
					} else {
						finish({ outcome: "diagnostics-ok", result: parsed.result });
					}
				}
			}
		});
		child.stderr.on("data", (chunk) => events.push({ stderr: chunk.toString("utf8") }));
		child.on("exit", (code, signal) => {
			finish({ outcome: "process-exit", exitCode: code, signal });
		});

		const uri = pathToFileURL(join(proj, "clean.ts")).href;
		child.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
			processId: process.pid,
			rootUri: pathToFileURL(proj).href,
			rootPath: proj,
			workspaceFolders: [{ uri: pathToFileURL(proj).href, name: "workspace" }],
			capabilities: {},
		} }));

		// Wait for the initialize response before the lifecycle continues, like OMO does.
		const waitInitializedSent = setInterval(() => {
			const initResponse = events.find((e) => e.id === 1 && ("result" in e || "error" in e));
			if (!initResponse) return;
			clearInterval(waitInitializedSent);

			// THE VARIABLE UNDER TEST: params present vs absent.
			const initializedMessage = { jsonrpc: "2.0", method: "initialized" };
			if (sendInitializedParams) initializedMessage.params = {};
			child.stdin.write(frame(initializedMessage));

			child.stdin.write(frame({ jsonrpc: "2.0", method: "workspace/didChangeConfiguration", params: { settings: { json: { validate: { enable: true } } } } }));
			child.stdin.write(frame({ jsonrpc: "2.0", method: "textDocument/didOpen", params: {
				textDocument: { uri, languageId: "typescript", version: 1, text: "export const answer = 42;\n" },
			} }));
			child.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "textDocument/diagnostic", params: {
				textDocument: { uri },
			} }));
		}, 25);

		setTimeout(() => finish({ outcome: "timeout-no-response" }), 20000);
	});
}

const a = await runScenario("A-paramless-initialized (4.19.4 wire shape)", false);
console.log(JSON.stringify(a, null, 2));
const b = await runScenario("B-initialized-with-empty-object (fixed wire shape)", true);
console.log(JSON.stringify(b, null, 2));

const summary = {
	A_bug_reproduced: a.outcome !== "diagnostics-ok",
	B_fix_verified: b.outcome === "diagnostics-ok",
};
console.log("SUMMARY " + JSON.stringify(summary));
