// Sidecar entry for the signed-in device account, bundled as extensions/omo-device-account.js and imported through
// `#omo-device-account-runtime`: the CLI account (the service-auth credential store, session refresh and account read)
// on the first memory sync resolve, and the desktop memory-sync claim, Worker port and desktop account once a desktop
// launch declares memory-sync (see account-runtime-loader.ts).

export { createCliAccountSource } from "./account-source"
export { accountSourceFromSelection } from "./selected-account-source"
export { claimInheritedDesktopSync } from "../desktop-sync/desktopClaim"
export { serveDesktopWorker, workerMemorySyncSource } from "../desktop-sync/workerPort"
