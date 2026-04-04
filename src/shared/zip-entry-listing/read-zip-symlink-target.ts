import { spawn } from "bun"

export async function readZipSymlinkTarget(
	archivePath: string,
	entryPath: string
): Promise<string | undefined> {
	const proc = spawn(["unzip", "-p", archivePath, "--", entryPath], {
		stdout: "pipe",
		stderr: "pipe",
	})

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])

	if (exitCode !== 0) {
		throw new Error(`zip symlink target read failed (exit ${exitCode}): ${stderr}`)
	}

	return stdout || undefined
}
