import { beforeEach } from "bun:test"
import { resetTestDeadline } from "./test-deadline"

// The root preload (test-setup.ts) resets the deadline before every test; package-level bunfigs do not load it,
// so without this hook a package-local `bun test` would share one deadline across the whole run.
beforeEach(resetTestDeadline)
