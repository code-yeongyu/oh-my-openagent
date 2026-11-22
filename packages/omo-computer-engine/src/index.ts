import { packageName as protocolPackageName } from "@oh-my-opencode/omo-computer-protocol"

/** Locator, checksum and signature trust, stable-path launch and bunshin descriptor of the omo-computer-engine binary. */
export const packageName = "@oh-my-opencode/omo-computer-engine" as const

/** The packages this one depends on, exactly the edges of the architecture table. */
export const dependencyPackageNames = [protocolPackageName] as const
