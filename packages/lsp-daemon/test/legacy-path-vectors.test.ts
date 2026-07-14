import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";

import vectors from "./fixtures/legacy-path-vectors.json";

describe("immutable legacy daemon path vectors", () => {
	it("#given the captured Unix vectors #when checking the pre-migration digest contract #then they retain exact natural and hashed paths", () => {
		// given
		const natural = vectors.naturalUnix;
		const hashed = vectors.hashedUnix;

		// when
		const hashedDigest = createHash("sha256").update(hashed.expected.versionDir).digest("hex").slice(0, 16);

		// then
		expect(natural.expected.socket).toBe(posix.join(natural.expected.versionDir, "daemon.sock"));
		expect(hashed.expected.versionDir.length).toBeGreaterThanOrEqual(100);
		expect(hashed.expected.socket).toBe(
			posix.join(hashed.inputs.tmpdir, `omo-lsp-${vectors.version}-${hashedDigest}.sock`),
		);
	});

	it("#given the captured Windows vector #when checking the pre-migration digest contract #then it retains the exact named pipe", () => {
		// given
		const windows = vectors.windowsNamedPipe;

		// when
		const digest = createHash("sha256").update(windows.expected.versionDir).digest("hex").slice(0, 16);

		// then
		expect(windows.expected.versionDir).toBe(win32.join(windows.expected.baseDir, `v${vectors.version}`));
		expect(windows.expected.socket).toBe(`\\\\.\\pipe\\omo-lsp-${vectors.version}-${digest}`);
	});

	it("#given the characterization metadata #when Todo 8 consumes the fixture #then the source commit and hash stay pinned", () => {
		expect(vectors.schemaVersion).toBe(1);
		expect(vectors.capturedCommit).toBe("616d30bddcc7982f539602611ea2508c25360eb9");
		expect(vectors.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(vectors.sourceSha256).toBe("dd749af7e71f406acf9a8a93fe8fc7dd8850d2984e15808b920f7f54794f7bd5");
	});
});
