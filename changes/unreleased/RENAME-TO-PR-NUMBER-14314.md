### Fixed

- Compiled omo binaries advertise the embedded Senpi CalVer in host `engineVersion` and `engineOrdinal`, so upgrade handoffs can order hosts by engine version. The omo release version remains in `serverVersion` (#14314).
