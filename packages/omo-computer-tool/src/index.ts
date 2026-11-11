import { packageName as sdkPackageName } from "@oh-my-opencode/omo-computer-sdk"
import { packageName as protocolPackageName } from "@oh-my-opencode/omo-computer-protocol"

/** The computer tool, CUA adapter, settings, /computer command and generated skill of computer-use v3. */
export const packageName = "@oh-my-opencode/omo-computer-tool" as const

/** The packages this one depends on, exactly the edges of the architecture table. */
export const dependencyPackageNames = [sdkPackageName, protocolPackageName] as const
