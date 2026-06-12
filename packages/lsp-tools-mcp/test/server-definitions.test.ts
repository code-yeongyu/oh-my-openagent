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

	it("#given julials #when looking it up #then bootstraps LanguageServer.jl via julia on PATH", () => {
		// given
		const julia = BUILTIN_SERVERS["julials"];

		// when / then
		expect(julia).toBeDefined();
		expect(julia?.command[0]).toBe("julia");
		expect(julia?.command).toContain("-e");
		expect(julia?.command).toContain("using LanguageServer; runserver()");
		expect(julia?.extensions).toEqual([".jl"]);
	});

	it("#given julials install guidance #when inspecting registry #then auto-installable via Pkg.add", () => {
		// given
		const hint = LSP_INSTALL_HINTS["julials"];
		const auto = AUTO_INSTALLABLE_SERVERS["julials"];

		// when / then
		expect(hint).toContain("Pkg.add");
		expect(hint).toContain("LanguageServer");
		expect(auto).toBeDefined();
		expect(auto?.[0]).toBe("julia");
		expect(auto).toContain('using Pkg; Pkg.add("LanguageServer")');
	});

	it("#given razor #when looking it up #then maps to roslyn-language-server over stdio", () => {
		// given
		const razor = BUILTIN_SERVERS["razor"];

		// when / then
		expect(razor).toBeDefined();
		expect(razor?.command[0]).toBe("roslyn-language-server");
		expect(razor?.command).toContain("--stdio");
		expect(razor?.extensions).toEqual([".razor", ".cshtml"]);
	});

	it("#given razor install guidance #when inspecting registry #then manual dotnet-tool install only", () => {
		// given
		const hint = LSP_INSTALL_HINTS["razor"];

		// when / then
		expect(AUTO_INSTALLABLE_SERVERS["razor"]).toBeUndefined();
		expect(hint).toContain("roslyn-language-server");
		expect(hint).toContain("dotnet tool install");
	});

	it("#given kotlin-ls #when looking it up #then starts kotlin-lsp over stdio", () => {
		// given
		const kotlin = BUILTIN_SERVERS["kotlin-ls"];

		// when / then
		expect(kotlin).toBeDefined();
		expect(kotlin?.command).toEqual(["kotlin-lsp", "--stdio"]);
		expect(kotlin?.extensions).toEqual([".kt", ".kts"]);
	});

	it("#given sourcekit-lsp #when looking it up #then binds Swift and Objective-C file extensions", () => {
		// given
		const sourcekit = BUILTIN_SERVERS["sourcekit-lsp"];

		// when / then
		expect(sourcekit).toBeDefined();
		expect(sourcekit?.command[0]).toBe("sourcekit-lsp");
		expect(sourcekit?.extensions).toEqual([".swift", ".m", ".mm"]);
	});
});
