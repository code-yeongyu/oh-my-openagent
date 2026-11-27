// The remote module's third public entry (#13414, guard S3): the device-service administration the CLI and the launchers
// run (install, bootstrap, cold wake) and this device's operator endpoint leg. It reaches the network and opens sockets,
// so index.ts and lazy.ts never reach it (admin.test.ts) and `omo remote`'s local-only path never imports it.
export {
  type BootstrapDependencies,
  type BootstrapOutcome,
  bootstrapDeviceService,
  type ColdWakeOutcome,
  ColdWakeUnitError,
  DEVICE_SERVICE_VERSION,
  deviceServiceHost,
  installColdWake,
  installDeviceService,
  readColdWake,
  refreshColdWake,
  runCommand,
  SessionHostLaunch,
  uninstallColdWake,
  type UnitState,
} from "@oh-my-opencode/device-service-core"
export { createLocalSessions } from "./local-sessions"
