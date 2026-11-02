// Sandbox wiring every EQ.omo case shares (fused-equivalence-e2e.mjs): the built plugin's trust, every config/state
// root inside the case sandbox, the telemetry opt-out, and the omo config the case runs with.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTelemetryOptOut } from "./telemetry-opt-out-env.mjs";

export function prepareCaseSandbox(run, omoConfig) {
	const root = run.box.dir;
	run.env.PATH = run.childPath;
	// The CLI child gets its env from the senpi harness sandbox, which opts out of senpi's own telemetry (PI_TELEMETRY=0)
	// but not the plugin's. Off CI (no CI variable) and with a run root outside the OS temp dir, the plugin's consent gate
	// then reads the child as a real install: telemetry ON and the first-run notice in the observations (MRUN-P0 A2).
	Object.assign(run.env, withTelemetryOptOut(run.env));
	for (const [name, dir] of [
		["XDG_CONFIG_HOME", "xdg-config"],
		["XDG_DATA_HOME", "xdg-data"],
		["XDG_CACHE_HOME", "xdg-cache"],
		["XDG_STATE_HOME", "xdg-state"],
	]) {
		run.env[name] = join(root, dir);
		mkdirSync(run.env[name], { recursive: true });
	}
	run.env.OMO_CODING_AGENT_DIR = run.box.agentDir;
	run.env.PI_CODING_AGENT_DIR = run.box.agentDir;
	run.env.OMO_MEMORY_HOME = join(root, "memory");
	// The child's os.tmpdir() reaches the observations (the computer skill is materialized under it and listed as a
	// skill root: senpi-desktop-tool/src/skill.ts materializeComputerSkill), so it is pinned inside the sandbox and the
	// recording host's TMPDIR never reaches a golden.
	const tmp = join(root, "tmp");
	mkdirSync(tmp, { recursive: true });
	for (const name of ["TMPDIR", "TMP", "TEMP"]) run.env[name] = tmp;
	writeFileSync(join(run.box.agentDir, "trust.json"), `${JSON.stringify({ [run.box.cwd]: true }, null, 2)}\n`);
	// The plugin's two remote MCP servers would reach the network, and its local `_ast_grep` server connects on its own
	// schedule: whether that connect lands before or after the host records the session's first loaded-surfaces digest
	// decides whether a `loaded_surfaces_changed` is announced at all (both seen in B0 runs on darwin and linux). The user
	// mcp.json switch the plugin documents turns all three off, so no case depends on a connect race; none of E21-E24
	// exercises an MCP tool.
	writeFileSync(
		join(run.box.agentDir, "mcp.json"),
		`${JSON.stringify({ mcpServers: { context7: { enabled: false }, grep_app: { enabled: false }, _ast_grep: { enabled: false } } }, null, 2)}\n`,
	);
	mkdirSync(join(run.box.cwd, ".omo"), { recursive: true });
	writeFileSync(join(run.box.cwd, ".omo", "omo.json"), `${JSON.stringify(omoConfig, null, 2)}\n`);
}
