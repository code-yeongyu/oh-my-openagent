import { packageName as protocolPackageName } from "@oh-my-opencode/omo-computer-protocol"

/** Typed facade, transports, fleet controller, run cell and error mapper of computer-use v3. */
export const packageName = "@oh-my-opencode/omo-computer-sdk" as const

/** The packages this one depends on, exactly the edges of the architecture table. */
export const dependencyPackageNames = [protocolPackageName] as const
