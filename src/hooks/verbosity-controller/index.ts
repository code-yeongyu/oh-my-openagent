import { VerbosityController } from "../../shared/verbosity-controller"

export function createVerbosityControllerHook() {
	const controller = new VerbosityController()

	return {
		"tool.execute.after": async (
			_input: { tool: string; sessionID: string; callID: string },
			output: { title: string; output: string; metadata: unknown }
		): Promise<void> => {
			const metadata = output.metadata as Record<string, unknown> | undefined
			const usage = metadata?.usage as { percentage?: number } | undefined
			const usagePercentage = usage?.percentage

			if (typeof usagePercentage !== "number") {
				return
			}

			const mode = controller.getVerbosityMode(usagePercentage)

			if (mode === "normal") {
				return
			}

			const instructions = controller.getVerbosityInstructions(mode)
			if (instructions) {
				output.output += `\n\n${instructions}`
			}
		},
	}
}
