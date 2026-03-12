import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test"
import * as sender from "./session-notification-sender"
import * as utils from "./session-notification-utils"
import type { PluginInput } from "@opencode-ai/plugin"



function createShellPromise(handler: (cmdStr: string) => void) {
	return (cmd: TemplateStringsArray, ...values: unknown[]) => {
		const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
		handler(cmdStr)

		const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }
		const promise = Promise.resolve(result) as Promise<typeof result> & {
			quiet: () => Promise<typeof result>
			nothrow: () => Promise<typeof result> & { quiet: () => Promise<typeof result> }
		}
		promise.quiet = () => promise
		promise.nothrow = () => {
			const p = Promise.resolve(result) as typeof promise
			p.quiet = () => p
			p.nothrow = () => p
			return p
		}
		return promise
	}
}

function createThrowingShellPromise(shouldThrow: (cmdStr: string) => boolean) {
	return (cmd: TemplateStringsArray, ...values: unknown[]) => {
		const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")

		const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }

		if (shouldThrow(cmdStr)) {
			const err = Object.assign(new Error("command failed"), result)
			const rejectedPromise = Promise.reject(err) as Promise<typeof result> & {
				quiet: () => Promise<typeof result>
				nothrow: () => Promise<typeof result> & { quiet: () => Promise<typeof result> }
			}
			rejectedPromise.quiet = () => rejectedPromise
			rejectedPromise.nothrow = () => {
				const p = Promise.resolve(result) as typeof rejectedPromise
				p.quiet = () => p
				p.nothrow = () => p
				return p
			}
			return rejectedPromise
		}

		const promise = Promise.resolve(result) as Promise<typeof result> & {
			quiet: () => Promise<typeof result>
			nothrow: () => Promise<typeof result> & { quiet: () => Promise<typeof result> }
		}
		promise.quiet = () => promise
		promise.nothrow = () => {
			const p = Promise.resolve(result) as typeof promise
			p.quiet = () => p
			p.nothrow = () => p
			return p
		}
		return promise
	}
}

describe("session-notification-sender", () => {
	beforeEach(() => {
		jest.restoreAllMocks()
		spyOn(utils, "getTerminalNotifierPath").mockResolvedValue("/usr/local/bin/terminal-notifier")
		spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")
		spyOn(utils, "getNotifySendPath").mockResolvedValue("/usr/bin/notify-send")
		spyOn(utils, "getPowershellPath").mockResolvedValue("powershell")
		spyOn(utils, "getAfplayPath").mockResolvedValue("/usr/bin/afplay")
		spyOn(utils, "getPaplayPath").mockResolvedValue("/usr/bin/paplay")
		spyOn(utils, "getAplayPath").mockResolvedValue("/usr/bin/aplay")
	})

	describe("#given sendSessionNotification", () => {
		describe("#when calling ctx.$ for notifications", () => {
			test("#then should call .quiet() on all shell commands to suppress stdout/stderr", async () => {
				const quietCalls: string[] = []
				const mockCtx = {
					$: (cmd: TemplateStringsArray, ...values: unknown[]) => {
						const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
						const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }
						const promise = Promise.resolve(result) as Promise<typeof result> & {
							quiet: () => Promise<typeof result>
							nothrow: () => typeof promise
						}
						promise.quiet = () => {
							quietCalls.push(cmdStr)
							return promise
						}
						promise.nothrow = () => promise
						return promise
					},
				} as unknown as PluginInput

				await sender.sendSessionNotification(mockCtx, "darwin", "Test", "Message")

				expect(quietCalls.length).toBeGreaterThanOrEqual(1)
				expect(quietCalls[0]).toContain("terminal-notifier")
			})

			test("#then should call .quiet() on osascript fallback", async () => {
				spyOn(utils, "getTerminalNotifierPath").mockResolvedValue(null)

				const quietCalls: string[] = []
				const mockCtx = {
					$: (cmd: TemplateStringsArray, ...values: unknown[]) => {
						const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
						const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }
						const promise = Promise.resolve(result) as Promise<typeof result> & {
							quiet: () => typeof promise
							nothrow: () => typeof promise & { quiet: () => typeof promise }
						}
						promise.quiet = () => {
							quietCalls.push(cmdStr)
							return promise
						}
						promise.nothrow = () => {
							const p = Promise.resolve(result) as typeof promise
							p.quiet = () => {
								quietCalls.push(cmdStr)
								return p
							}
							p.nothrow = () => p
							return p
						}
						return promise
					},
				} as unknown as PluginInput

				await sender.sendSessionNotification(mockCtx, "darwin", "Test", "Message")

				expect(quietCalls.length).toBeGreaterThanOrEqual(1)
				expect(quietCalls[0]).toContain("osascript")
			})

			test("#then should call .quiet() on linux notify-send", async () => {
				const quietCalls: string[] = []
				const mockCtx = {
					$: (cmd: TemplateStringsArray, ...values: unknown[]) => {
						const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
						const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }
						const promise = Promise.resolve(result) as Promise<typeof result> & {
							quiet: () => typeof promise
							nothrow: () => typeof promise & { quiet: () => typeof promise }
						}
						promise.quiet = () => {
							quietCalls.push(cmdStr)
							return promise
						}
						promise.nothrow = () => {
							const p = Promise.resolve(result) as typeof promise
							p.quiet = () => {
								quietCalls.push(cmdStr)
								return p
							}
							p.nothrow = () => p
							return p
						}
						return promise
					},
				} as unknown as PluginInput

				await sender.sendSessionNotification(mockCtx, "linux", "Test", "Message")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("notify-send")
			})

			test("#then should call .quiet() on win32 powershell", async () => {
				const quietCalls: string[] = []
				const mockCtx = {
					$: (cmd: TemplateStringsArray, ...values: unknown[]) => {
						const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
						const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }
						const promise = Promise.resolve(result) as Promise<typeof result> & {
							quiet: () => typeof promise
							nothrow: () => typeof promise & { quiet: () => typeof promise }
						}
						promise.quiet = () => {
							quietCalls.push(cmdStr)
							return promise
						}
						promise.nothrow = () => {
							const p = Promise.resolve(result) as typeof promise
							p.quiet = () => {
								quietCalls.push(cmdStr)
								return p
							}
							p.nothrow = () => p
							return p
						}
						return promise
					},
				} as unknown as PluginInput

				await sender.sendSessionNotification(mockCtx, "win32", "Test", "Message")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("powershell")
			})
		})
	})

	describe("#given playSessionNotificationSound", () => {
		describe("#when calling ctx.$ for sound playback", () => {
			test("#then should call .quiet() on darwin afplay", async () => {
				const quietCalls: string[] = []
				const mockCtx = {
					$: (cmd: TemplateStringsArray, ...values: unknown[]) => {
						const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
						const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }
						const promise = Promise.resolve(result) as Promise<typeof result> & {
							quiet: () => typeof promise
							nothrow: () => typeof promise & { quiet: () => typeof promise }
						}
						promise.quiet = () => {
							quietCalls.push(cmdStr)
							return promise
						}
						promise.nothrow = () => {
							const p = Promise.resolve(result) as typeof promise
							p.quiet = () => {
								quietCalls.push(cmdStr)
								return p
							}
							p.nothrow = () => p
							return p
						}
						return promise
					},
				} as unknown as PluginInput

				await sender.playSessionNotificationSound(mockCtx, "darwin", "/sound.aiff")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("afplay")
			})

			test("#then should call .quiet() on linux paplay", async () => {
				const quietCalls: string[] = []
				const mockCtx = {
					$: (cmd: TemplateStringsArray, ...values: unknown[]) => {
						const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
						const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }
						const promise = Promise.resolve(result) as Promise<typeof result> & {
							quiet: () => typeof promise
							nothrow: () => typeof promise & { quiet: () => typeof promise }
						}
						promise.quiet = () => {
							quietCalls.push(cmdStr)
							return promise
						}
						promise.nothrow = () => {
							const p = Promise.resolve(result) as typeof promise
							p.quiet = () => {
								quietCalls.push(cmdStr)
								return p
							}
							p.nothrow = () => p
							return p
						}
						return promise
					},
				} as unknown as PluginInput

				await sender.playSessionNotificationSound(mockCtx, "linux", "/sound.oga")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("paplay")
			})

			test("#then should call .quiet() on linux aplay fallback", async () => {
				spyOn(utils, "getPaplayPath").mockResolvedValue(null)

				const quietCalls: string[] = []
				const mockCtx = {
					$: (cmd: TemplateStringsArray, ...values: unknown[]) => {
						const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
						const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }
						const promise = Promise.resolve(result) as Promise<typeof result> & {
							quiet: () => typeof promise
							nothrow: () => typeof promise & { quiet: () => typeof promise }
						}
						promise.quiet = () => {
							quietCalls.push(cmdStr)
							return promise
						}
						promise.nothrow = () => {
							const p = Promise.resolve(result) as typeof promise
							p.quiet = () => {
								quietCalls.push(cmdStr)
								return p
							}
							p.nothrow = () => p
							return p
						}
						return promise
					},
				} as unknown as PluginInput

				await sender.playSessionNotificationSound(mockCtx, "linux", "/sound.oga")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("aplay")
			})

			test("#then should call .quiet() on win32 powershell sound", async () => {
				const quietCalls: string[] = []
				const mockCtx = {
					$: (cmd: TemplateStringsArray, ...values: unknown[]) => {
						const cmdStr = cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")
						const result = { stdout: Buffer.from(""), stderr: Buffer.from(""), exitCode: 0 }
						const promise = Promise.resolve(result) as Promise<typeof result> & {
							quiet: () => typeof promise
							nothrow: () => typeof promise & { quiet: () => typeof promise }
						}
						promise.quiet = () => {
							quietCalls.push(cmdStr)
							return promise
						}
						promise.nothrow = () => {
							const p = Promise.resolve(result) as typeof promise
							p.quiet = () => {
								quietCalls.push(cmdStr)
								return p
							}
							p.nothrow = () => p
							return p
						}
						return promise
					},
				} as unknown as PluginInput

				await sender.playSessionNotificationSound(mockCtx, "win32", "C:\\sound.wav")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("powershell")
			})
		})
	})
})
