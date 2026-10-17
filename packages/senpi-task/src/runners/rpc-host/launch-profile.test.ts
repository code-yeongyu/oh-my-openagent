import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { daemonLaunchProfileId } from "./launch-options"
import { readDaemonLaunchSpec } from "./launch-spec"

/**
 * Two ensures that read the SAME spec file must agree on the launch profile, or the second one
 * decides the running host is foreign and hands the socket over mid-flight. The compiled entry
 * reaches the spec through a symlinked prefix while the in-process runner sees the real path.
 */
// The document the plugin build ships, byte for byte, so the reader's schema is the real one.
const SPEC = "{\n  \"spec_version\": 1,\n  \"core\": {\n    \"session_runtime\": \"in-process\",\n    \"multi_session\": true,\n    \"extensions\": [\n      \".\",\n      \"./extensions/omo-member.js\"\n    ]\n  },\n  \"tunables\": {\n    \"idleExitMs\": 900000,\n    \"coldStart\": \"transient\"\n  },\n  \"env\": {\n    \"OMO_NATIVE\": \"1\"\n  }\n}"

describe("daemonLaunchProfileId", () => {
  test("#given one spec reached through a symlink and through its real path #when both profile ids are computed #then they are identical", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "dh-profile-"))
    const real = join(root, "real", "plugin")
    mkdirSync(join(real, "extensions"), { recursive: true })
    writeFileSync(join(real, "daemon-launch-spec.json"), SPEC)
    // The reader refuses a spec whose extensions are not on disk.
    writeFileSync(join(real, "extensions", "omo-member.js"), "export {}\n")
    symlinkSync(join(root, "real"), join(root, "link"))
    const viaLink = join(root, "link", "plugin", "daemon-launch-spec.json")
    const viaReal = join(realpathSync(real), "daemon-launch-spec.json")

    // when
    const fromLink = daemonLaunchProfileId(readDaemonLaunchSpec(viaLink), viaLink)
    const fromReal = daemonLaunchProfileId(readDaemonLaunchSpec(viaReal), viaReal)

    // then
    expect(fromLink).toBe(fromReal)
    rmSync(root, { recursive: true, force: true })
  })
})
