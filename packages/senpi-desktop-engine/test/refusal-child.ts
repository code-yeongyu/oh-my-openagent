import { spawn } from "node:child_process";
import { ENGINE_ABI, PROTOCOL_VERSION } from "@oh-my-opencode/senpi-desktop-protocol";

export const refusalRecord = (reason = "self-responsible"): string =>
	`SENPI_DESKTOP_LAUNCH_REFUSED ${JSON.stringify({ version: 1, reason })}\n`;

export const legacySelf = "senpi-desktop-engine: refusing to run as its own responsible process (pid 41): spawn the engine as a child of the app, terminal or host that holds the computer-use grants, without the responsibility-disclaim attribute and not as a launchd job or through a shell exec\n";
export const legacyUnresolved = "senpi-desktop-engine: refusing to run: the responsible process of engine pid 41 cannot be resolved\n";

export interface RefusalOptions {
	readonly stderr?: string;
	readonly code?: number;
	readonly hello?: boolean;
	readonly abi?: string;
	readonly waitForCancel?: boolean;
	readonly split?: boolean;
}

/** Real pipes and close events; stderr writes finish before the fixture exits. */
export function refusalChild(options: RefusalOptions = {}) {
	const script = `
		const { createInterface } = require("node:readline");
		const options = ${JSON.stringify(options)};
		const hello = ${JSON.stringify({ abi: ENGINE_ABI, protocolVersion: PROTOCOL_VERSION, buildSha: "fixture", engineVersion: "fixture" })};
		const record = ${JSON.stringify(refusalRecord())};
		const lines = createInterface({input: process.stdin});
		let received = false;
		let remaining;
		lines.on("line", (line) => {
			if (received && remaining) { const flush = remaining; remaining = undefined; flush(); return; }
			if (received || (options.waitForCancel && JSON.parse(line).method !== "$/cancel")) return;
			received = true;
			const finish = () => {
				const text = options.stderr ?? record;
				const middle = Math.floor(text.length / 2);
				const flush = () => process.stderr.write(text.slice(middle), () => {
						process.exitCode = options.code ?? 1;
						lines.close();
						process.stdin.destroy();
				});
				if (options.split) {
					remaining = flush;
					process.stderr.write(text.slice(0, middle));
				} else process.stderr.write(text.slice(0, middle), flush);
			};
			if (options.hello) {
				hello.abi = options.abi ?? hello.abi;
				process.stdout.write(JSON.stringify({jsonrpc:"2.0", id:1, result:hello})+"\\n", finish);
			} else finish();
		});
	`;
	return spawn(process.execPath, ["-e", script], { stdio: "pipe" });
}
