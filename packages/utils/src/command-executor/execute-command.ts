import { exec } from "node:child_process"
import { promisify } from "node:util"

const execAsync = promisify(exec)

type ExecError = { stdout?: Buffer; stderr?: Buffer; message?: string }

export async function executeCommand(command: string): Promise<string> {
	try {
		const { stdout, stderr } = await execAsync(command)

		const out = stdout?.toString().trim() ?? ""
		const err = stderr?.toString().trim() ?? ""

		if (err) {
			return out ? `${out}\n[stderr: ${err}]` : `[stderr: ${err}]`
		}

		return out
	} catch (error: unknown) {
		const e = error as ExecError
		const stdout = e?.stdout?.toString().trim() ?? ""
		const stderr = e?.stderr?.toString().trim() ?? ""
		const errorMessage = stderr || e?.message || String(error)

		return stdout ? `${stdout}\n[stderr: ${errorMessage}]` : `[stderr: ${errorMessage}]`
	}
}
