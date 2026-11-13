import type * as deviceServiceCore from "@oh-my-opencode/device-service-core"
import { packageName as sdkPackageName } from "@oh-my-opencode/omo-computer-sdk"

/** Relay and bunshin HandCarrier implementations of computer-use v3. */
export const packageName = "@oh-my-opencode/omo-computer-carriers" as const

/** The device service SDK the relay carrier is built on; only its types are linked until that carrier exists. */
export type DeviceServiceCore = typeof deviceServiceCore

/** The packages this one depends on, exactly the edges of the architecture table (the bunshin machine SDK is an optional peer). */
export const dependencyPackageNames = [sdkPackageName, "@oh-my-opencode/device-service-core"] as const
