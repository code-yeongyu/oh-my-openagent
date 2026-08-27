import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const buildScript = join(packageRoot, "scripts", "build.mjs");

it.skipIf(process.platform !== "win32")(
	"#given Node at an absolute path containing spaces #when the atomic build runs #then the stamped version argument remains intact",
	() => {
		// given
		const tempRoot = mkdtempSync(join(tmpdir(), "lsp-daemon-execpath-"));
		const copiedNodeDir = join(tempRoot, "node with spaces");
		const copiedNode = join(copiedNodeDir, basename(process.execPath));
		const distDir = join(tempRoot, "dist");
		const shimDir = join(tempRoot, "shims");

		try {
			mkdirSync(copiedNodeDir, { recursive: true });
			mkdirSync(shimDir, { recursive: true });
			copyFileSync(process.execPath, copiedNode);
			writeFileSync(join(shimDir, "tsc.cmd"), "@exit /b 0\r\n");
			writeFileSync(
				join(shimDir, "bun.cmd"),
				[
					"@echo off",
					":next",
					'if "%~1"=="" exit /b 2',
					'if /i "%~1"=="--outdir" goto found',
					"shift",
					"goto next",
					":found",
					"shift",
					'if "%~1"=="" exit /b 3',
					'if not exist "%~1" mkdir "%~1"',
					'type nul > "%~1\\cli.js"',
					"exit /b 0",
				].join("\r\n"),
			);
			expect(isAbsolute(copiedNode)).toBe(true);
			expect(copiedNode).toMatch(/\s/);

			// when
			execFileSync(copiedNode, [buildScript], {
				cwd: packageRoot,
				encoding: "utf8",
				env: {
					...process.env,
					OMO_LSP_DAEMON_DIST: distDir,
					PATH: `${shimDir}${delimiter}${process.env["PATH"] ?? ""}`,
				},
				stdio: "pipe",
			});

			// then
			const stamped = JSON.parse(readFileSync(join(distDir, "package.json"), "utf8")) as { version: string };
			expect(stamped.version).toBe("0.1.0");
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
			expect(existsSync(tempRoot)).toBe(false);
		}
	},
);
