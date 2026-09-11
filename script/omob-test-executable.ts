import { spawnSync } from "node:child_process"
import { rmSync, writeFileSync } from "node:fs"

/** A real native executable: Windows does not execute POSIX shebang fixtures. */
export function writeTestExecutable(destination: string, source: string): void {
	const entry = `${destination}.fixture.cjs`
	writeFileSync(entry, source)
	try {
		const result = spawnSync(process.execPath, ["build", "--compile", entry, "--outfile", destination], { encoding: "utf8", timeout: 30_000 })
		if (result.error) throw result.error
		if (result.status !== 0) throw new Error(`fixture compilation failed: ${result.stdout}${result.stderr}`)
	} finally {
		rmSync(entry, { force: true })
	}
}
