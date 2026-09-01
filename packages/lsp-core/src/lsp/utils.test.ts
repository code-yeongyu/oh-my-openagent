import { describe, expect, test } from "bun:test";

import { LspProcessExitedError } from "./errors.js";
import { formatKnownLspStartupFailure, handleMissingDependencyError } from "./utils.js";

describe("formatKnownLspStartupFailure", () => {
	test("#given rust-src component conflict #when formatting startup failure #then returns repair guidance", () => {
		// given
		const error = new LspProcessExitedError(
			"rust",
			"/repo",
			1,
			"failed to install component: 'rust-src', detected conflict: 'lib/rustlib/src/rust/library/Cargo.lock'",
		);

		// when
		const message = formatKnownLspStartupFailure(error);

		// then
		expect(message).toContain("rust-analyzer");
		expect(message).toContain("rustup component remove rust-src");
		expect(message).toContain("rustup component add rust-src");
		expect(message).toContain("detected conflict");
		expect(message).toContain("Cargo.lock");
		expect(message).not.toContain("automatic repair");
	});

	test("#given rust-analyzer sysroot error #when handling missing dependency #then returns repair guidance", () => {
		// given
		const error = new LspProcessExitedError(
			"rust",
			"/repo",
			1,
			"can't load standard library from sysroot\ntry installing `rust-src` the same way you installed `rustc`",
		);

		// when
		const message = handleMissingDependencyError(error);

		// then
		expect(message).toContain("rustup component remove rust-src");
		expect(message).toContain("rustup component add rust-src");
		expect(message).toContain("can't load standard library");
	});

	test("#given unrelated process exits #when formatting startup failure #then returns null", () => {
		// given
		const typescriptError = new LspProcessExitedError(
			"typescript",
			"/repo",
			1,
			"failed to install component: 'rust-src', detected conflict",
		);
		const rustPanic = new LspProcessExitedError("rust", "/repo", 1, "thread panicked while loading crate graph");

		// when / then
		expect(formatKnownLspStartupFailure(typescriptError)).toBeNull();
		expect(formatKnownLspStartupFailure(rustPanic)).toBeNull();
	});
});

describe("handleMissingDependencyError", () => {
	test("#given existing dependency messages #when handling error #then preserves current messages", () => {
		// given
		const notInstalled = new Error("LSP server 'typescript' is configured but NOT INSTALLED.");
		const notConfigured = new Error("No LSP server configured for extension: .md");

		// when / then
		expect(handleMissingDependencyError(notInstalled)).toBe(notInstalled.message);
		expect(handleMissingDependencyError(notConfigured)).toBe(notConfigured.message);
	});
});
