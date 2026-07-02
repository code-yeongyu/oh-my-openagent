#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const [component, ...componentArgs] = process.argv.slice(2);

if (component === undefined || !/^[a-z0-9-]+$/.test(component)) {
  console.error("omo-ai hook runner: missing or invalid component name.");
  process.exit(1);
}

const hookSource = process.env["SENPI_HOOK_SOURCE"];
if (hookSource === undefined || hookSource.length === 0) {
  console.error("omo-ai hook runner: SENPI_HOOK_SOURCE is required.");
  process.exit(1);
}

const senpiRoot = dirname(dirname(hookSource));
const packageRoot = dirname(senpiRoot);
const componentCli = join(senpiRoot, "components", component, "dist", "cli.js");

if (!existsSync(componentCli)) {
  console.error(`omo-ai hook runner: component CLI does not exist: ${componentCli}`);
  process.exit(1);
}

const pluginData = process.env["PLUGIN_DATA"] && process.env["PLUGIN_DATA"].length > 0
  ? process.env["PLUGIN_DATA"]
  : join(tmpdir(), "omo-ai-plugin-data");

const result = spawnSync(process.execPath, [componentCli, ...componentArgs], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PLUGIN_ROOT: packageRoot,
    PLUGIN_DATA: pluginData,
    CLAUDE_PLUGIN_ROOT: packageRoot,
    CLAUDE_PLUGIN_DATA: pluginData,
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(`omo-ai hook runner: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
