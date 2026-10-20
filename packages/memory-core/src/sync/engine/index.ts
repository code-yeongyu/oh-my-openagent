export { createHttpTransport, SyncHttpError, type HttpTransportOptions } from "./adapters/http-transport"
export { type EngineStatus, SyncEngine } from "./engine"
// The sync sidecar re-exports the Loro loader so a packaged install can prove the wasm beside it loads.
export { loadLoroRuntime } from "../../crdt/loro-runtime"
export { caseFold } from "../item/casefold"
export { type DeviceSync, openDeviceSync, type OpenDeviceSyncOptions, type SyncSession } from "./open"
export type { RefusalCode, Sealer, Transport, Verifier } from "./ports"
