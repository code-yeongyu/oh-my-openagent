### Added
- Device service client: the delivery-consumer requests of #13037 (`deliveries.serve`, `delivery.answer`, `delivery.held`, `delivery.pending`, `delivery.drained`, `peer.admitted`) and their events (`delivery.inbound`, `delivery.holds`, `delivery.wake`), in the shapes omo-relay-daemon #1076 ships, behind `connectDeliveryConsumer` in `device-service-core`. The conformance fixtures are copied in-tree from that release.
- Thread gateway: the engine's delivery consumer now connects to the device service through that client, so a delivery from another device for a session here that is not running is taken in, answered, and the session started. It still serves nothing until `MIN_WAKE_ENGINE_VERSION` names the engine release that drops a released session's retained record (senpi#6449).

### Fixed
- Thread gateway: the delivery consumer listens before it declares itself, so the records the device service hands it right after the acknowledgement are no longer dropped. It counts as serving from that acknowledgement, so a session it wakes during its own start is opened, not left switched off.
