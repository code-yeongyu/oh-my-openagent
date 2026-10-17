import { describe, expect, spyOn, test } from "bun:test"
import { TEARDOWN_FAILURE_PREFIX } from "../packages/omo-native/test/teardown.test-support"
import { removeTempRoot } from "./remove-temp-root"

function failing(code: string): (path: string) => void {
	return () => {
		throw Object.assign(new Error(`${code}: rm`), { code })
	}
}

describe("removeTempRoot", () => {
	test("#given win32 and a busy root #when removed #then it warns once and leaves the root for the OS", () => {
		const warn = spyOn(console, "warn").mockImplementation(() => {})
		let attempts = 0
		try {
			removeTempRoot("C:\\Temp\\omob-pair-x", (path) => { attempts += 1; failing("EBUSY")(path) }, "win32")
			expect(attempts).toBe(1)
			expect(warn).toHaveBeenCalledTimes(1)
			expect(String(warn.mock.calls[0]?.[0])).toStartWith(TEARDOWN_FAILURE_PREFIX)
		} finally {
			warn.mockRestore()
		}
	})

	test("#given win32 and any other errno #when removed #then it throws on the first attempt", () => {
		expect(() => removeTempRoot("C:\\Temp\\omob-pair-x", failing("EPERM"), "win32")).toThrow("EPERM")
	})

	test("#given POSIX and a busy root #when removed #then it throws", () => {
		expect(() => removeTempRoot("/tmp/omob-pair-x", failing("EBUSY"), "linux")).toThrow("EBUSY")
	})
})
