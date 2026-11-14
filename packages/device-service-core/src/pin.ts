/**
 * The device service version this omo build pins: 0.1.27, the signed omo-relay-daemon release device-service-v0.1.27
 * (min_engine_version 5.1.62; checksums.txt signed by the operational key in release/release-key.json). A running
 * service older than this is replaced by the pinned release at start-up; nothing else moves an installed service, so
 * a new relayd release reaches omo users only through a bump here, after get.omo.dev serves it.
 */
export const DEVICE_SERVICE_VERSION = "0.1.27"
