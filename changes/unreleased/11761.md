### Fixed

- Team-core locks no longer treat a live sibling worker's module UUID as a dead process (#11752). Records distinguish OS process-start identity from worker incarnation; reclamation requires proven process exit/reuse, host-observed worker exit, or an exact release. Unknown workers keep their locks, and delayed releases cannot delete replacement owners.
