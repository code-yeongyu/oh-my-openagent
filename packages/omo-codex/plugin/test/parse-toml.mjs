import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export function parseToml(config) {
	const python = resolvePython();
	const result = spawnSync(
		python,
		[
			"-c",
			"import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))",
		],
		{ encoding: "utf8", input: config },
	);
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

function resolvePython() {
	for (const command of ["python3", "python"]) {
		const result = spawnSync(command, ["-c", "import tomllib"], {
			encoding: "utf8",
		});
		if (result.status === 0) return command;
	}
	assert.fail("Python with tomllib is required for TOML parse assertions");
}
