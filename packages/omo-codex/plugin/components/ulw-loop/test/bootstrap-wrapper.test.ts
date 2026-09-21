import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

for (const suffix of process.platform === "win32" ? ["", ".cmd"] : [""]) {
	it(`#given toolkit${suffix} outside PATH #when bootstrap resolves it #then executes the wrapper`, async () => {
		const root = await mkdtemp(join(tmpdir(), "ulw bootstrap "));
		try {
			const home = join(root, "home");
			const codex = join(root, "codex");
			await mkdir(join(codex, "bin"), { recursive: true });
			await mkdir(home);
			const wrapper = join(codex, "bin", `omo-agent-toolkit${suffix}`);
			await writeFile(wrapper, suffix === ".cmd"
				? "@echo off\r\nif \"%~2\"==\"help\" exit /b 0\r\necho toolkit %*\r\n"
				: "#!/bin/sh\n[ \"$2\" = help ] && exit 0\nprintf 'toolkit %s %s\\n' \"$1\" \"$2\"\n");
			await chmod(wrapper, 0o755);
			const text = await readFile(new URL("../skills/ulw-loop/references/full-workflow.md", import.meta.url), "utf8");
			const bootstrap = text.split("```sh\n")[1]?.split("\n```")[0];
			expect(bootstrap).toBeDefined();
			const shell = process.platform === "win32"
				? join(process.env["ProgramFiles"] ?? "C:/Program Files", "Git", "bin", "bash.exe")
				: "/bin/sh";
			const result = spawnSync(shell, ["-c", `${bootstrap}\nulw_loop ulw-loop status`], {
				encoding: "utf8",
				env: { ...process.env, HOME: home.replaceAll("\\", "/"), CODEX_HOME: codex.replaceAll("\\", "/"), PATH: "/usr/bin:/bin" },
			});
			expect(result.error).toBeUndefined();
			expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
			expect(result.stdout.trim()).toBe("toolkit ulw-loop status");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
