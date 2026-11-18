### Fixed

- When another device refuses a `thread_send` or `thread_handoff` because the chain went past that device user's thread chain limit (`threads.chainCountLimit`), the tool now answers `chain_count_limit`, naming the device and the setting, instead of `unsupported` with advice to update omo on that device.
