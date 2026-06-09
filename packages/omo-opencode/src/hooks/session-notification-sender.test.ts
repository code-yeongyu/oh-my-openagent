/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import * as sender from "./session-notification-sender"
import * as utils from "./session-notification-utils"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"



type TestShellResult = ReturnType<NonNullable<PluginInput["$"]>>
type TestShellFactory = (cmd: TemplateStringsArray, ...values: unknown[]) => TestShellResult

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

type ExecFileCall = {
	readonly file: string
	readonly args: readonly string[]
	readonly options: { readonly windowsHide?: boolean }
}

function mockExecFile(calls: ExecFileCall[], error: Error | null = null): ReturnType<typeof spyOn> {
	return spyOn(childProcess, "execFile").mockImplementation(
		unsafeTestValue<typeof childProcess.execFile>(
			(
				file: string,
				args: readonly string[],
				options: { readonly windowsHide?: boolean },
				callback: (execError: Error | null, stdout: string, stderr: string) => void
			) => {
				calls.push({ file, args: [...args], options })
				callback(error, "", "")
				return unsafeTestValue<ReturnType<typeof childProcess.execFile>>({})
			}
		)
	)
}

describe("session-notification-sender", () => {
	beforeEach(() => {
		jest.restoreAllMocks()
		spyOn(utils, "getCmuxPath").mockResolvedValue(null)
		spyOn(utils, "getTerminalNotifierPath").mockResolvedValue("/usr/local/bin/terminal-notifier")
		spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")
		spyOn(utils, "getNotifySendPath").mockResolvedValue("/usr/bin/notify-send")
		spyOn(utils, "getPowershellPath").mockResolvedValue("powershell")
		spyOn(utils, "getAfplayPath").mockResolvedValue("/usr/bin/afplay")
		spyOn(utils, "getPaplayPath").mockResolvedValue("/usr/bin/paplay")
		spyOn(utils, "getAplayPath").mockResolvedValue("/usr/bin/aplay")
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	describe("#given sendSessionNotification", () => {
		describe("#when ctx.$ is unavailable", () => {
			test("#then it falls back to execFile without throwing", async () => {
				const execFileCalls: ExecFileCall[] = []
				mockExecFile(execFileCalls)
				const mockCtx = unsafeTestValue<PluginInput>({})

				await sender.sendSessionNotification(mockCtx, "win32", "Test", "Message")

				expect(execFileCalls.length).toBe(1)
				expect(execFileCalls[0]?.file).toBe("powershell")
				expect(execFileCalls[0]?.args[0]).toBe("-Command")
				expect(execFileCalls[0]?.options.windowsHide).toBe(true)
			})

			test("#then it swallows execFile rejection without throwing", async () => {
				const execFileCalls: ExecFileCall[] = []
				mockExecFile(execFileCalls, new Error("execFile failed"))
				const mockCtx = unsafeTestValue<PluginInput>({})

				await sender.sendSessionNotification(mockCtx, "win32", "Test", "Message")

				expect(execFileCalls.length).toBe(1)
			})
		})

		describe("#when calling ctx.$ for notifications", () => {
			test("#then should call .quiet() on all shell commands to suppress stdout/stderr", async () => {
				const quietCalls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
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
				})

				await sender.sendSessionNotification(mockCtx, "darwin", "Test", "Message")

				expect(quietCalls.length).toBeGreaterThanOrEqual(1)
				expect(quietCalls[0]).toContain("terminal-notifier")
			})

			test("#then should call .quiet() on osascript fallback", async () => {
				spyOn(utils, "getTerminalNotifierPath").mockResolvedValue(null)

				const quietCalls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
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
				})

				await sender.sendSessionNotification(mockCtx, "darwin", "Test", "Message")

				expect(quietCalls.length).toBeGreaterThanOrEqual(1)
				expect(quietCalls[0]).toContain("osascript")
			})

			test("#then should use cmux when available", async () => {
				spyOn(utils, "getCmuxPath").mockResolvedValue("/usr/local/bin/cmux")

				const calls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
					$: createShellPromise((cmdStr) => { calls.push(cmdStr) }),
				})

				await sender.sendSessionNotification(mockCtx, "darwin", "Test", "Message")

				expect(calls.length).toBe(1)
				expect(calls[0]).toContain("cmux")
				expect(calls[0]).not.toContain("terminal-notifier")
				expect(calls[0]).not.toContain("osascript")
			})

			test("#then should fall back to terminal-notifier when cmux fails", async () => {
				spyOn(utils, "getCmuxPath").mockResolvedValue("/usr/local/bin/cmux")

				const mockCtx = unsafeTestValue<PluginInput>({
					$: createThrowingShellPromise((cmdStr) => cmdStr.includes("cmux notify")),
				})

				const originalFactory = unsafeTestValue<TestShellFactory>(mockCtx.$)
				const trackingCalls: string[] = []
				mockCtx.$ = unsafeTestValue<typeof mockCtx.$>((cmd: TemplateStringsArray, ...values: unknown[]) => {
					const cmdStr = cmd.reduce((acc: string, part: string, i: number) => acc + part + (values[i] ?? ""), "")
					trackingCalls.push(cmdStr)
					return originalFactory(cmd, ...values)
				})

				await sender.sendSessionNotification(mockCtx, "darwin", "Test", "Message")

				expect(trackingCalls.some((c) => c.includes("cmux notify"))).toBe(true)
				expect(trackingCalls.some((c) => c.includes("terminal-notifier"))).toBe(true)
				expect(trackingCalls.some((c) => c.includes("osascript"))).toBe(false)
			})

			test("#then should fall back to osascript when cmux and terminal-notifier both fail", async () => {
				spyOn(utils, "getCmuxPath").mockResolvedValue("/usr/local/bin/cmux")

				const trackingCalls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
					$: createThrowingShellPromise((cmdStr) => cmdStr.includes("cmux notify") || cmdStr.includes("terminal-notifier")),
				})

				const originalFactory = unsafeTestValue<TestShellFactory>(mockCtx.$)
				mockCtx.$ = unsafeTestValue<typeof mockCtx.$>((cmd: TemplateStringsArray, ...values: unknown[]) => {
					const cmdStr = cmd.reduce((acc: string, part: string, i: number) => acc + part + (values[i] ?? ""), "")
					trackingCalls.push(cmdStr)
					return originalFactory(cmd, ...values)
				})

				await sender.sendSessionNotification(mockCtx, "darwin", "Test", "Message")

				expect(trackingCalls.some((c) => c.includes("cmux notify"))).toBe(true)
				expect(trackingCalls.some((c) => c.includes("terminal-notifier"))).toBe(true)
				expect(trackingCalls.some((c) => c.includes("osascript"))).toBe(true)
			})

			test("#then should skip cmux when not available and use terminal-notifier", async () => {
				const calls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
					$: createShellPromise((cmdStr) => { calls.push(cmdStr) }),
				})

				await sender.sendSessionNotification(mockCtx, "darwin", "Test", "Message")

				expect(calls.length).toBe(1)
				expect(calls[0]).toContain("terminal-notifier")
				expect(calls[0]).not.toContain("cmux notify")
			})

			test("#then should call .quiet() on linux notify-send", async () => {
				const quietCalls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
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
				})

				await sender.sendSessionNotification(mockCtx, "linux", "Test", "Message")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("notify-send")
			})

			test("#then should call .quiet() on win32 powershell", async () => {
				const quietCalls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
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
				})

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
				const mockCtx = unsafeTestValue<PluginInput>({
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
				})

				await sender.playSessionNotificationSound(mockCtx, "darwin", "/sound.aiff")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("afplay")
			})

			test("#then should call .quiet() on linux paplay", async () => {
				const quietCalls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
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
				})

				await sender.playSessionNotificationSound(mockCtx, "linux", "/sound.oga")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("paplay")
			})

			test("#then should call .quiet() on linux aplay fallback", async () => {
				spyOn(utils, "getPaplayPath").mockResolvedValue(null)

				const quietCalls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
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
				})

				await sender.playSessionNotificationSound(mockCtx, "linux", "/sound.oga")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("aplay")
			})

			test("#then should call .quiet() on win32 powershell sound", async () => {
				const quietCalls: string[] = []
				const mockCtx = unsafeTestValue<PluginInput>({
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
				})

				await sender.playSessionNotificationSound(mockCtx, "win32", "C:\\sound.wav")

				expect(quietCalls.length).toBe(1)
				expect(quietCalls[0]).toContain("powershell")
			})
		})
	})
})
