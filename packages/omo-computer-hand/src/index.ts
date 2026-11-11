import { packageName as sdkPackageName } from "@oh-my-opencode/omo-computer-sdk"
import { packageName as enginePackageName } from "@oh-my-opencode/omo-computer-engine"

/** Hand host parts of computer-use v3 in the spawning and attach-only profiles. */
export const packageName = "@oh-my-opencode/omo-computer-hand" as const

/** The packages this one depends on, exactly the edges of the architecture table. */
export const dependencyPackageNames = [sdkPackageName, enginePackageName] as const
