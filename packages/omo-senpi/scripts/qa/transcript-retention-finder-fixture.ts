// Standalone proof fixture for transcript-retention-e2e.mjs: run the EXISTING Senpi session
// finder (thread address-book disk scan) over a sessions root and print the result as JSON.
// Type-only imports keep this runnable standalone under bun.
import { scanDiskSessions } from "../../src/components/thread/address-book.ts"

const sessionsDir = process.argv[2]
if (sessionsDir === undefined || sessionsDir.length === 0) {
	console.error("usage: bun transcript-retention-finder-fixture.ts <sessionsDir>")
	process.exit(2)
}

process.stdout.write(JSON.stringify({ sessions: scanDiskSessions(sessionsDir) }, null, 2))
