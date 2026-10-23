import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const createdDirs: string[] = [];

function createTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	createdDirs.push(dir);
	return dir;
}

export function removeFakeBunFixtures(): void {
	for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface FakeBunBehavior {
	readonly commands: readonly ("check" | "lint" | "format")[];
	readonly checkStdout?: string;
	readonly checkExitCode?: number;
	readonly lintStdout?: string;
	readonly lintExitCode?: number;
	readonly formatWrites?: boolean;
	readonly hangHelpUntil?: string;
	readonly wrapperForks?: boolean;
}

export interface FakeBunCall {
	readonly args: readonly string[];
	readonly cwd: string;
	readonly cwdEntries: readonly string[];
}

export interface FakeBun {
	readonly path: string;
	calls(): FakeBunCall[];
	upgrade(behavior: FakeBunBehavior): void;
}

export function createFakeBun(behavior: FakeBunBehavior): FakeBun {
	const dir = createTempDir("omo-fake-bun-");
	const logPath = join(dir, "calls.jsonl");
	const binDir = join(dir, "bin");
	mkdirSync(binDir);
	const path = process.platform === "win32" ? join(binDir, "bun.cmd") : join(binDir, "bun");
	let version = 0;
	const install = (next: FakeBunBehavior) => {
		version += 1;
		const scriptPath = join(dir, `fake-bun-${version}.mjs`);
		writeFakeBunScript(scriptPath, logPath, next);
		if (process.platform === "win32") {
			writeFileSync(path, `@"${process.execPath}" "${scriptPath}" %*\r\n`);
		} else {
			const launch = `"${process.execPath}" "${scriptPath}" "$@"`;
			writeFileSync(path, next.wrapperForks ? `#!/bin/sh\n${launch}\n` : `#!/bin/sh\nexec ${launch}\n`);
			chmodSync(path, 0o755);
		}
	};
	install(behavior);
	return {
		path,
		upgrade: install,
		calls: () =>
			existsSync(logPath)
				? readFileSync(logPath, "utf8")
						.split("\n")
						.filter((line) => line.length > 0)
						.map((line): FakeBunCall => JSON.parse(line))
				: [],
	};
}

function writeFakeBunScript(scriptPath: string, logPath: string, behavior: FakeBunBehavior): void {
	writeFileSync(
		scriptPath,
		[
			'import { appendFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";',
			`const behavior = ${JSON.stringify(behavior)};`,
			'if (behavior.hangHelpUntil && process.argv.includes("--help") && !existsSync(behavior.hangHelpUntil)) await new Promise((r) => setTimeout(r, 60_000));',
			"const args = process.argv.slice(2);",
			`appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, cwd: process.cwd(), cwdEntries: readdirSync(process.cwd()) }) + "\\n");`,
			"const [command] = args;",
			"if (!behavior.commands.includes(command)) process.exit(1);",
			'if (args.includes("--help")) process.exit(0);',
			'if (command === "check") { process.stdout.write(behavior.checkStdout ?? ""); process.exit(behavior.checkExitCode ?? 0); }',
			'if (command === "lint") { process.stdout.write(behavior.lintStdout ?? "[]"); process.exit(behavior.lintExitCode ?? 0); }',
			'if (command === "format" && behavior.formatWrites && args.includes("--write")) writeFileSync(args[args.length - 1], "const a = 1;\\n");',
			"process.exit(0);",
		].join("\n"),
	);
}

export function createProject(files: Record<string, string>, options: { readonly git?: boolean } = {}): string {
	const root = createTempDir("omo-bun-project-");
	if (options.git !== false) mkdirSync(join(root, ".git"));
	for (const [relativePath, content] of Object.entries(files)) {
		const target = join(root, relativePath);
		mkdirSync(join(target, ".."), { recursive: true });
		writeFileSync(target, content);
	}
	return root;
}
