/**
 * The device service version this omo build pins: 0.1.9, the first signed relayd release. It carries the
 * keychain-free relay sign-in (design D PR 3; device.adopt.account, first in 0.1.3 = ADOPT_ACCOUNT_MIN_SERVICE_VERSION)
 * and the live-streaming and resume fixes up to 0.1.9. A running service older than this is replaced by the pinned
 * release at start-up.
 */
export const DEVICE_SERVICE_VERSION = "0.1.9"
