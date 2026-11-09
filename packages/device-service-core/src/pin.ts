/**
 * The device service version this omo build pins: 0.1.3, the first relayd release carrying omo-relay-daemon#730
 * (keychain-free relay sign-in, design D PR 3; device.adopt.account, ADOPT_ACCOUNT_MIN_SERVICE_VERSION). A running
 * service older than this is replaced by the pinned release at start-up.
 */
export const DEVICE_SERVICE_VERSION = "0.1.3"
