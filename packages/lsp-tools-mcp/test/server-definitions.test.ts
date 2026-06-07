import { describe, expect, it } from "vitest";

import { AUTO_INSTALLABLE_SERVERS, BUILTIN_SERVERS, LSP_INSTALL_HINTS } from "../src/lsp/server-definitions.js";

describe("BUILTIN_SERVERS", () => {
	it("#given rust #when looking it up #then maps to rust-analyzer", () => {
		// given
		const rust = BUILTIN_SERVERS["rust"];

		// when / then
		expect(rust).toBeDefined();
		expect(rust?.command[0]).toBe("rust-analyzer");
		expect(rust?.extensions).toEqual([".rs"]);
	});

	it("#given rust install guidance #when inspecting registry #then rust is manual install only", () => {
		// given
		const hint = LSP_INSTALL_HINTS["rust"];

		// when / then
		expect(AUTO_INSTALLABLE_SERVERS["rust"]).toBeUndefined();
		expect(hint).toContain("rust-analyzer");
		expect(hint).toContain("rustup component add rust-analyzer");
		expect(hint).toContain("rustup component remove rust-src");
		expect(hint).toContain("rustup component add rust-src");
	});
});
