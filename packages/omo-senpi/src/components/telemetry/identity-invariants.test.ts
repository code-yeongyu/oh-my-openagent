import { describe, expect, test } from "bun:test"

import { createOmoNativeProductConfig } from "./product-identity"
import { SENPI_MACHINE_ID_PREFIX, SENPI_TELEMETRY_EVENT_NAME } from "./index"

// The user-visible notices were renamed from the internal adapter id to the product brand. The
// telemetry IDENTIFIERS deliberately did not move: the analytics dashboards join on these exact
// values, so renaming one silently breaks continuity rather than failing loudly. These assertions
// exist to make that break loud.

describe("telemetry identity is stable across the OmO Native wording rename", () => {
	test("#given the legacy daily-active event #when its name is read #then it is unchanged", () => {
		// given / when / then
		expect(SENPI_TELEMETRY_EVENT_NAME).toBe("omo_senpi_daily_active")
	})

	test("#given the anonymous machine id #when its prefix is read #then it is unchanged", () => {
		// given / when / then
		expect(SENPI_MACHINE_ID_PREFIX).toBe("omo-senpi:")
	})

	test("#given the product config #when read #then platform and productName are unchanged", () => {
		// given / when
		const product = createOmoNativeProductConfig()

		// then
		expect(product.platform).toBe("omo-senpi")
		expect(product.productName).toBe("omo-native")
	})
})
