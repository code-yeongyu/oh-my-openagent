import { expect, test, vi } from "vitest";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { acquireDesktopEngine } from "../src/acquire";

test("retains the attempted cache path when reading its bytes throws EACCES", async () => {
	const root = fs.mkdtempSync(join(tmpdir(), "omo-acquire-error-"));
	const cached = join(root, "5.1.4", "win32-x64", `${"a".repeat(64)}-00000000-0000-4000-8000-000000000003`, "senpi-desktop-engine-win32-x64.exe");
	fs.mkdirSync(dirname(cached), { recursive: true });
	fs.writeFileSync(cached, "unreadable engine");
	const denied = vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
		throw Object.assign(new Error("EACCES: cache read denied"), { code: "EACCES" });
	});
	syncBuiltinESMExports();
	let fetched = 0;
	try {
		const result = await acquireDesktopEngine({
			version: "5.1.4", host: "win32-x64", cacheDir: root, allowDownload: false,
			locatorOptions: { runtimeDir: "", packageDir: join(root, "package"), execDir: join(root, "bin"), repoRoot: join(root, "repo") },
			fetch: async () => { fetched += 1; throw new Error("unexpected fetch"); },
		});
		expect(result.path).toBeNull();
		if (result.path !== null) throw new Error("unreadable cache must be unavailable");
		expect(result.diagnostic.cause).toBe("EACCES: cache read denied");
		expect(result.diagnostic.attemptedPaths).toContain(cached);
		expect(fetched).toBe(0);
	} finally {
		denied.mockRestore();
		syncBuiltinESMExports();
		fs.rmSync(root, { recursive: true, force: true });
	}
});
