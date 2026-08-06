#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const vitest = spawnSync("vitest", ["--run", ...process.argv.slice(2)], { stdio: "inherit" });
if (vitest.status !== 0) process.exit(vitest.status ?? 1);

const nodeTest = spawnSync(process.execPath, ["--test", "scripts/*.test.mjs"], { stdio: "inherit" });
process.exit(nodeTest.status ?? 1);
