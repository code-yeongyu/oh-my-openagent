import { spawnSync } from "node:child_process";
import { computerPreludeAssets } from "../src/index";

export function pythonCommandForPlatform(platform: NodeJS.Platform): string {
	return platform === "win32" ? "python" : "python3";
}

const PYTHON_COMMAND = pythonCommandForPlatform(process.platform);
const PYTHON_DIAGNOSTICS = process.env.OMO_DESKTOP_PRELUDE_PYTHON_DIAGNOSTICS === "1";

if (PYTHON_DIAGNOSTICS) {
	const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
	const startedAt = performance.now();
	const lookup = spawnSync(lookupCommand, [PYTHON_COMMAND], { encoding: "utf8" });
	console.error(
		`PYTHON_FACADE_DIAG ${JSON.stringify({
			phase: "command-lookup",
			platform: process.platform,
			processId: process.pid,
			command: PYTHON_COMMAND,
			elapsedMs: performance.now() - startedAt,
			status: lookup.status,
			signal: lookup.signal,
			stdout: lookup.stdout.trim().split(/\r?\n/),
			stderr: lookup.stderr.trim(),
			errorName: lookup.error?.name ?? null,
		})}`,
	);
}

/** What a kernel's `tool.<name>()` resolves to (codemode `marshalToolResult`). */
export interface ToolResult {
	readonly text: string;
	readonly details?: unknown;
	readonly images?: readonly unknown[];
	readonly hasError?: boolean;
}

export type Responder = (args: Record<string, unknown>) => ToolResult;

type AsyncBody = new (...parameters: string[]) => (...args: unknown[]) => Promise<unknown>;
const AsyncFunction: AsyncBody = Object.getPrototypeOf(async () => {}).constructor;

export const WINDOW_SNAPSHOT = {
	id: "w1",
	app: "Code",
	title: "main.ts",
	pid: 42,
	bounds: { x: 0, y: 0, width: 800, height: 600 },
	focused: true,
};

export const ELEMENT_SNAPSHOT = {
	ref: "e1",
	role: "button",
	nativeRole: "AXButton",
	enabled: true,
	focused: false,
	childCount: 0,
};

export const IMAGE = { mimeType: "image/png", dataBase64: "iVBORw0KGgo=" };

/** Answers a one-step `window` / `ref` chain with a window / element snapshot and every other call with no value. */
export const windowResponder: Responder = (args) => {
	const chain = Array.isArray(args.chain) ? args.chain : [];
	const root = chain.length === 1 ? chain[0].method : undefined;
	if (root === "window") return { text: "", details: { value: WINDOW_SNAPSHOT } };
	if (root === "ref") return { text: "", details: { value: ELEMENT_SNAPSHOT } };
	return { text: "" };
};

export interface JsKernel {
	/** Every `tool.computer` argument object, as the JSON bridge carries it. */
	readonly calls: readonly Record<string, unknown>[];
	readonly displayed: readonly unknown[];
	/** Runs an async function body with the facade bound to `computer`. */
	run(body: string): Promise<unknown>;
}

/** Installs the JavaScript facade against a fake kernel global whose `tool.computer` answers with `respond`. */
export function loadJsFacade(respond: Responder): JsKernel {
	const calls: Record<string, unknown>[] = [];
	const displayed: unknown[] = [];
	const kernelGlobal: Record<string, unknown> = {
		tool: {
			computer: async (args: unknown): Promise<ToolResult> => {
				const wire: Record<string, unknown> = JSON.parse(JSON.stringify(args));
				calls.push(wire);
				return respond(wire);
			},
		},
		display: (value: unknown) => displayed.push(value),
	};
	new Function("globalThis", computerPreludeAssets.javascript)(kernelGlobal);
	return { calls, displayed, run: (body) => new AsyncFunction("computer", body)(kernelGlobal.computer) };
}

/** Result of one Python facade run: recorded tool calls, displayed values, `out`, and a raised error if any. */
export interface PythonRun {
	readonly calls: readonly Record<string, unknown>[];
	readonly displayed: readonly unknown[];
	readonly out: unknown;
	readonly error: string | null;
}

// A fake `tool` whose `computer(**args)` answers like `windowResponder`, fails `clipboard.write` with hasError,
// and returns one image for `screenshot`; then the facade runs in a namespace holding that `tool` and `display`.
const PYTHON_HARNESS = `
import json, sys
payload = json.load(sys.stdin)
calls, displayed = [], []
WINDOW = json.loads(payload["window"])
ELEMENT = json.loads(payload["element"])
IMAGE = json.loads(payload["image"])
class _Tool:
    def computer(self, **args):
        calls.append(args)
        chain = args.get("chain") or []
        last = chain[-1]["method"] if chain else None
        if len(chain) == 1 and last == "window":
            return {"text": "", "details": {"value": WINDOW}, "images": [], "hasError": False}
        if len(chain) == 1 and last == "ref":
            return {"text": "", "details": {"value": ELEMENT}, "images": [], "hasError": False}
        if last == "clipboard.write":
            return {"text": "PermissionDenied: computer:exec is denied", "images": [], "hasError": True}
        if last == "screenshot":
            return {"text": "", "details": {"value": {"width": 1}}, "images": [IMAGE], "hasError": False}
        return {"text": ""}
ns = {"tool": _Tool(), "display": displayed.append}
exec(payload["prelude"], ns)
error = None
try:
    exec(payload["script"], ns)
except Exception as caught:
    error = f"{type(caught).__name__}: {caught}"
print(json.dumps({"calls": calls, "displayed": displayed, "out": ns.get("out"), "error": error}))
`;

/** Runs `script` in a real Python interpreter after the facade was installed; `script` may assign `out`. */
export function runPythonFacade(script: string): PythonRun {
	const input = JSON.stringify({
		prelude: computerPreludeAssets.python,
		script,
		window: JSON.stringify(WINDOW_SNAPSHOT),
		element: JSON.stringify(ELEMENT_SNAPSHOT),
		image: JSON.stringify(IMAGE),
	});
	const startedAt = performance.now();
	const result = spawnSync(PYTHON_COMMAND, ["-c", PYTHON_HARNESS], { input, encoding: "utf8", timeout: 30_000 });
	if (PYTHON_DIAGNOSTICS) {
		console.error(
			`PYTHON_FACADE_DIAG ${JSON.stringify({
				phase: "facade-run",
				platform: process.platform,
				processId: process.pid,
				childProcessId: result.pid,
				command: PYTHON_COMMAND,
				elapsedMs: performance.now() - startedAt,
				status: result.status,
				signal: result.signal,
				errorName: result.error?.name ?? null,
				stdoutBytes: result.stdout.length,
				stderrBytes: result.stderr.length,
				inputBytes: input.length,
			})}`,
		);
	}
	if (result.status !== 0) throw new Error(`${PYTHON_COMMAND} exited ${result.status}: ${result.error?.message ?? result.stderr}`);
	return JSON.parse(result.stdout);
}
