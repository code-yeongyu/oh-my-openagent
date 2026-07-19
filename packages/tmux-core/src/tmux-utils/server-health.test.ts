import { describe, expect, it } from "bun:test"

import { createServerHealthStateForTesting, isServerRunning } from "./server-health"

const hostname = "127.0.0.1"
const healthPath = "/global/health"
const rejectedCredentialCases = [
	{ name: "no credentials", password: undefined, username: undefined },
	{ name: "wrong credentials", password: "wrong-password-fixture", username: "wrong-user-fixture" },
] as const
const acceptedCredentialCases = [
	{ name: "password-only credentials", password: "password-only-fixture", username: undefined, expectedUsername: "opencode" },
	{ name: "explicit username credentials", password: "explicit-password-fixture", username: "explicit-user-fixture", expectedUsername: "explicit-user-fixture" },
	{ name: "explicit empty username", password: "empty-user-password-fixture", username: "", expectedUsername: "" },
	{ name: "UTF-8 credentials", password: "pässwörd-fixture", username: "用户名-fixture", expectedUsername: "用户名-fixture" },
] as const

function snapshotAuthEnvironment() {
	return {
		password: process.env.OPENCODE_SERVER_PASSWORD,
		username: process.env.OPENCODE_SERVER_USERNAME,
	}
}

function restoreEnvironmentVariable(name: "OPENCODE_SERVER_PASSWORD" | "OPENCODE_SERVER_USERNAME", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name]
		return
	}
	process.env[name] = value
}

function restoreAuthEnvironment(snapshot: ReturnType<typeof snapshotAuthEnvironment>): void {
	restoreEnvironmentVariable("OPENCODE_SERVER_PASSWORD", snapshot.password)
	restoreEnvironmentVariable("OPENCODE_SERVER_USERNAME", snapshot.username)
}

describe("isServerRunning authentication and redirects", () => {
	for (const testCase of rejectedCredentialCases) {
		it(`#given ${testCase.name} #when authenticated health is checked #then it reports unavailable`, async () => {
			// given
			const environment = snapshotAuthEnvironment()
			const paths: string[] = []
			restoreEnvironmentVariable("OPENCODE_SERVER_PASSWORD", testCase.password)
			restoreEnvironmentVariable("OPENCODE_SERVER_USERNAME", testCase.username)

			try {
				const server = Bun.serve({
					hostname: "127.0.0.1",
					port: 0,
					fetch(request) {
						paths.push(new URL(request.url).pathname)
						const expected = `Basic ${Buffer.from("opencode:protected-password-fixture", "utf8").toString("base64")}`
						return new Response(null, { status: request.headers.get("authorization") === expected ? 200 : 401 })
					},
				})

				try {
					// when
					const result = await isServerRunning(`http://${hostname}:${server.port}`, {
						authentication: "opencode-server",
						state: createServerHealthStateForTesting(),
					})

					// then
					expect(paths.length > 0).toBe(true)
					expect(paths.every((path) => path === healthPath)).toBe(true)
					expect(result).toBe(false)
				} finally {
					await server.stop(true)
				}
			} finally {
				restoreAuthEnvironment(environment)
			}
		})
	}

	it("#given configured server credentials #when health is checked without authentication opt-in #then it sends no authorization", async () => {
		// given
		const environment = snapshotAuthEnvironment()
		const password = "default-auth-password-fixture"
		const username = "default-auth-user-fixture"
		const paths: string[] = []
		const authorizationHeaders: Array<string | null> = []
		process.env.OPENCODE_SERVER_PASSWORD = password
		process.env.OPENCODE_SERVER_USERNAME = username

		try {
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch(request) {
					paths.push(new URL(request.url).pathname)
					const authorization = request.headers.get("authorization")
					authorizationHeaders.push(authorization)
					const expected = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
					return new Response(null, { status: authorization === expected ? 200 : 401 })
				},
			})

			try {
				// when
				const result = await isServerRunning(`http://${hostname}:${server.port}`, {
					state: createServerHealthStateForTesting(),
				})

				// then
				expect(paths.length > 0).toBe(true)
				expect(paths.every((path) => path === healthPath)).toBe(true)
				expect(authorizationHeaders.every((header) => header === null)).toBe(true)
				expect(result).toBe(false)
			} finally {
				await server.stop(true)
			}
		} finally {
			restoreAuthEnvironment(environment)
		}
	})

	for (const testCase of acceptedCredentialCases) {
		it(`#given ${testCase.name} #when authenticated health is checked #then it authenticates`, async () => {
			// given
			const environment = snapshotAuthEnvironment()
			const paths: string[] = []
			restoreEnvironmentVariable("OPENCODE_SERVER_PASSWORD", testCase.password)
			restoreEnvironmentVariable("OPENCODE_SERVER_USERNAME", testCase.username)
			const expected = `Basic ${Buffer.from(`${testCase.expectedUsername}:${testCase.password}`, "utf8").toString("base64")}`

			try {
				const server = Bun.serve({
					hostname: "127.0.0.1",
					port: 0,
					fetch(request) {
						paths.push(new URL(request.url).pathname)
						return new Response(null, { status: request.headers.get("authorization") === expected ? 200 : 401 })
					},
				})

				try {
					// when
					const result = await isServerRunning(`http://${hostname}:${server.port}`, {
						authentication: "opencode-server",
						state: createServerHealthStateForTesting(),
					})

					// then
					expect(paths.length > 0).toBe(true)
					expect(paths.every((path) => path === healthPath)).toBe(true)
					expect(result).toBe(true)
				} finally {
					await server.stop(true)
				}
			} finally {
				restoreAuthEnvironment(environment)
			}
		})
	}

	it("#given a credentialed health redirect #when authenticated health is checked #then it rejects the redirect without contacting its target", async () => {
		// given
		const environment = snapshotAuthEnvironment()
		const password = "redirect-password-fixture"
		const username = "redirect-user-fixture"
		const sourcePaths: string[] = []
		const sourceAuthorizations: boolean[] = []
		let targetContacts = 0
		process.env.OPENCODE_SERVER_PASSWORD = password
		process.env.OPENCODE_SERVER_USERNAME = username
		const expected = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`

		try {
			const target = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch() {
					targetContacts += 1
					return new Response(null, { status: 200 })
				},
			})

			try {
				const source = Bun.serve({
					hostname: "127.0.0.1",
					port: 0,
					fetch(request) {
						sourcePaths.push(new URL(request.url).pathname)
						sourceAuthorizations.push(request.headers.get("authorization") === expected)
						return Response.redirect(`http://${hostname}:${target.port}/redirect-target`)
					},
				})

				try {
					// when
					const result = await isServerRunning(`http://${hostname}:${source.port}`, {
						authentication: "opencode-server",
						state: createServerHealthStateForTesting(),
					})

					// then
					expect(sourcePaths.length > 0).toBe(true)
					expect(sourcePaths.every((path) => path === healthPath)).toBe(true)
					expect(sourceAuthorizations.every(Boolean)).toBe(true)
					expect({ result, targetContacts }).toEqual({ result: false, targetContacts: 0 })
				} finally {
					await source.stop(true)
				}
			} finally {
				await target.stop(true)
			}
		} finally {
			restoreAuthEnvironment(environment)
		}
	})
})
