import { describe, expect, it } from "vitest";

import { createLspSpawnEnv } from "../src/lsp/transport.js";

describe("LspClientTransport environment", () => {
	it("#given workspace node_modules bin exists #when spawn env is created #then PATH is not extended with it", () => {
		// given
		const root = "/workspace/project";
		const env = { PATH: "/usr/bin" };

		// when
		const spawnEnv = createLspSpawnEnv(root, env);

		// then
		expect(spawnEnv["PATH"]).toBe("/usr/bin");
	});
});
