/**
 * The device service version this omo build pins: 0.1.13, the first device-service release published with Developer ID
 * signed, notarized darwin binaries and an Ed25519-signed checksums.txt (omo-relay-daemon device-service-v0.1.13). It
 * carries omo-relay-daemon#730 (keychain-free relay sign-in; device.adopt.account, ADOPT_ACCOUNT_MIN_SERVICE_VERSION
 * 0.1.3). A running service older than this is replaced by the pinned release at start-up.
 */
export const DEVICE_SERVICE_VERSION = "0.1.13"
