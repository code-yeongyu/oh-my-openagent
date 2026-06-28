import { spawn } from "../runtime"
import { readProcessStream } from "../process-stream-reader"

export async function readZipSymlinkTarget(
	archivePath: string,
	entryPath: string
): Promise<string | undefined> {
	const proc = spawn(["unzip", "-p", "--", archivePath, entryPath], {
		stdout: "pipe",
		stderr: "pipe",
	})

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		// #3919: Use Buffer-concat stream reads for Node utility-process compatibility.
		readProcessStream(proc.stdout),
		readProcessStream(proc.stderr),
	])

	if (exitCode !== 0) {
		throw new Error(`zip symlink target read failed (exit ${exitCode}): ${stderr}`)
	}

	return stdout || undefined
}
