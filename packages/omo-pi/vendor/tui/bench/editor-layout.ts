import { Editor } from "../src/components/editor.ts";
import { TUI } from "../src/tui.ts";
import { defaultEditorTheme } from "../test/test-themes.ts";
import { VirtualTerminal } from "../test/virtual-terminal.ts";
import { forceGc, metadata, percentile, readIterations } from "./_meta.ts";

const WIDTH = 120;
const text = Array.from({ length: 180 }, (_, index) => {
	const prefix = String(index).padStart(3, "0");
	return `${prefix}: ${"abcdefghijklmnopqrstuvwxyz ".repeat(6)} 한글 カナ emoji`;
}).join("\n");

function createEditor(): Editor {
	const tui = new TUI(new VirtualTerminal(WIDTH, 40));
	const editor = new Editor(tui, defaultEditorTheme);
	editor.setText(text);
	editor.render(WIDTH);
	return editor;
}

function runScenario(): number {
	const editor = createEditor();
	let lines = 0;
	for (let i = 0; i < 100; i++) {
		editor.handleInput(i % 2 === 0 ? "a" : "\x7f");
		lines += editor.render(WIDTH).length;
	}
	return lines;
}

function timeScenario(): number {
	const start = performance.now();
	const lines = runScenario();
	if (lines === 0) throw new Error("Expected editor output");
	return performance.now() - start;
}

const iterations = readIterations(20);
for (let i = 0; i < Math.min(3, iterations); i++) runScenario();
forceGc();
const before = process.memoryUsage();
const samples: number[] = [];
for (let i = 0; i < iterations; i++) samples.push(timeScenario());
forceGc();
const after = process.memoryUsage();

console.log(
	JSON.stringify({
		suite: "tui-editor",
		package: "@earendil-works/pi-tui",
		fixture: "180-line-editor-100-edits",
		iterations,
		samples,
		medianMs: percentile(samples, 50),
		p95Ms: percentile(samples, 95),
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
		metadata: metadata(),
	}),
);
