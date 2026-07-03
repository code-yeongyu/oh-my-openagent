import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const testFiles = readdirSync("test")
	.filter((file) => file.endsWith(".test.mjs"))
	.sort()
	.map((file) => join("test", file));

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
	stdio: "inherit",
});

process.exit(result.status ?? 1);
