import { spawn } from "node:child_process";
import { resolveSpawnCommand } from "../../plugin/scripts/spawn-command.mjs";

export async function defaultRunCommand(command, args, options) {
	await new Promise((resolvePromise, reject) => {
		const child = spawn(resolveSpawnCommand(command), args, {
			cwd: options.cwd,
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
			reject(new Error(`${command} ${args.join(" ")} failed in ${options.cwd} with ${suffix}`));
		});
	});
}
