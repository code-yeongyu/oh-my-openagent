import { homedir } from "node:os"
import { deviceServiceStateDir } from "../packages/device-service-core/src/state-dir"
import { installCredentialStoreTestGuard } from "./credential-store-test-guard"
import { installDeviceServiceTestGuard } from "./device-service-test-guard"

// Resolved before any hermetic home replaces HOME: this is the machine's own service, the one no test may reach.
export const guardedStateDir = deviceServiceStateDir(process.platform, process.env, homedir())
export const deviceServiceGuard = installDeviceServiceTestGuard(guardedStateDir)
export const credentialStoreGuard = installCredentialStoreTestGuard()
