import { spawn } from "node:child_process"
import { getHomeDirectory } from "./home-directory"
import { findBashPath, findZshPath } from "./shell-path"

export interface CommandResult {
	exitCode: number
	stdout?: string
	stderr?: string
}

export interface ExecuteHookOptions {
	forceZsh?: boolean
	zshPath?: string
}

export async function executeHookCommand(
	command: string,
	stdin: string,
	cwd: string,
	options?: ExecuteHookOptions,
): Promise<CommandResult> {
	const home = getHomeDirectory()

	const expandedCommand = command
		.replace(/^~(?=\/|$)/g, home)
		.replace(/\s~(?=\/)/g, ` ${home}`)
		.replace(/\$CLAUDE_PROJECT_DIR/g, cwd)
		.replace(/\$\{CLAUDE_PROJECT_DIR\}/g, cwd)

	let finalCommand = expandedCommand

	if (options?.forceZsh) {
		const zshPath = findZshPath(options.zshPath)
		const escapedCommand = expandedCommand.replace(/'/g, "'\\''")
		if (zshPath) {
			finalCommand = `${zshPath} -lc '${escapedCommand}'`
		} else {
			const bashPath = findBashPath()
			if (bashPath) {
				finalCommand = `${bashPath} -lc '${escapedCommand}'`
			}
		}
	}

	return new Promise((resolve) => {
		const proc = spawn(finalCommand, {
			cwd,
			shell: true,
			env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: cwd },
		})

		let stdout = ""
		let stderr = ""

		proc.stdout?.on("data", (data) => {
			stdout += data.toString()
		})

		proc.stderr?.on("data", (data) => {
			stderr += data.toString()
		})

		proc.stdin?.write(stdin)
		proc.stdin?.end()

		proc.on("close", (code) => {
			resolve({
				exitCode: code ?? 0,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
			})
		})

		proc.on("error", (err) => {
			resolve({ exitCode: 1, stderr: err.message })
		})
	})
}
