/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KEYCHAIN_HELPER_RELEASE_ASSET, KEYCHAIN_HELPER_SOURCE } from "./release-keychain-helper-target"
import { runBlock } from "./release-workflow-test-steps"
import {
  SUBPROCESS_TEST_TIMEOUT_MS,
  SUBPROCESS_SPAWN_TIMEOUT_MS,
  HELPER_BYTES,
  publishWorkflow,
  jobSteps,
  stepAt,
  bash,
  helperTarball,
  withRoot,
  mode,
} from "./keychain-helper-workflow.test-support"

describe("omo-ai keychain helper in publish-main (#11262)", () => {
  const steps = jobSteps(publishWorkflow, "publish-main")
  const notPublished = "needs.release-metadata.outputs.already_published != 'true'"

  test("stages the helper between the payload build and the release-mode payload verify", () => {
    const build = stepAt(steps, "Build omo-ai payload")
    const download = stepAt(steps, "Download keychain helper")
    const stage = stepAt(steps, "Stage keychain helper into the omo-ai payload")
    const restore = stepAt(steps, "Restore keychain helper from the existing release")
    const verify = stepAt(steps, "Verify omo-ai payload")

    expect([build.index, download.index, stage.index, restore.index, verify.index]).toEqual(
      [build.index, build.index + 1, build.index + 2, build.index + 3, build.index + 4],
    )
    expect(download.value.if).toBe(`inputs.skip_platform != true && inputs.lazycodex_only != true && ${notPublished}`)
    expect(stage.value.if).toBe(download.value.if)
    expect(restore.value.if).toBe(`inputs.skip_platform == true && inputs.lazycodex_only != true && ${notPublished}`)
    expect(restore.value.env).toEqual({ VERSION: "${{ needs.release-metadata.outputs.version }}", GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" })
    expect(verify.value.run).toBe("node script/verify-omo-ai-payload.mjs --release")
  })

  test.skipIf(process.platform === "win32")("extracts this run's helper with its execute bit", () => {
    withRoot("omo-keychain-omo-ai-", (root) => {
      helperTarball(root)
      const script = runBlock(publishWorkflow, "      - name: Stage keychain helper into the omo-ai payload\n", "      - name: Restore keychain helper from the existing release\n")
      const result = bash(script, root, {})
      expect(result.status, String(result.stderr)).toBe(0)
      expect(mode(join(root, KEYCHAIN_HELPER_SOURCE))).toBe(0o755)
    })
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  describe("skip_platform restores the release asset by digest and fails closed", () => {
    const script = runBlock(publishWorkflow, "      - name: Restore keychain helper from the existing release\n", "      - name: Verify omo-ai payload\n")
    const restore = (assets: Readonly<Record<string, string>>, sums: string) => {
      const root = mkdtempSync(join(tmpdir(), "omo-keychain-restore-"))
      const release = join(root, "release")
      mkdirSync(release)
      for (const [name, bytes] of Object.entries(assets)) writeFileSync(join(release, name), bytes)
      writeFileSync(join(release, "SHA256SUMS"), sums)
      const bin = join(root, "fake-bin")
      mkdirSync(bin)
      writeFileSync(join(bin, "gh"), [
        "#!/bin/bash",
        '[ "$1" = release ] && [ "$2" = download ] || exit 1',
        'shift 3; dir=""; patterns=()',
        'while [ "$#" -gt 0 ]; do case "$1" in --pattern) patterns+=("$2"); shift 2 ;; --dir) dir="$2"; shift 2 ;; *) exit 2 ;; esac; done',
        'found=0; for p in "${patterns[@]}"; do [ -f "$RELEASE_DIR/$p" ] && cp "$RELEASE_DIR/$p" "$dir/" && found=1; done',
        '[ "$found" = 1 ]',
        "",
      ].join("\n"))
      chmodSync(join(bin, "gh"), 0o755)
      if (spawnSync("bash", ["-c", "command -v shasum"], { timeout: SUBPROCESS_SPAWN_TIMEOUT_MS }).status !== 0) {
        writeFileSync(join(bin, "shasum"), '#!/bin/bash\n[ "$1" = -a ] && [ "$2" = 256 ] || exit 2\nshift 2\nexec sha256sum "$@"\n')
        chmodSync(join(bin, "shasum"), 0o755)
      }
      const stepTemp = join(root, "step-tmp")
      mkdirSync(stepTemp)
      const result = bash(script, root, { PATH: `${bin}:${process.env.PATH ?? ""}`, RELEASE_DIR: release, VERSION: "5.0.0", TMPDIR: stepTemp })
      return { root, result, installed: join(root, KEYCHAIN_HELPER_SOURCE), stepTemp }
    }
    const line = (name: string, bytes: string): string => `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`

    test.skipIf(process.platform === "win32")("installs a digest-matching asset with mode 0755", () => {
      const { root, result, installed, stepTemp } = restore({ [KEYCHAIN_HELPER_RELEASE_ASSET]: HELPER_BYTES }, line("omo-linux-x64", "x") + line(KEYCHAIN_HELPER_RELEASE_ASSET, HELPER_BYTES))
      try {
        expect(result.status, String(result.stderr)).toBe(0)
        expect(mode(installed)).toBe(0o755)
        expect(readFileSync(installed, "utf8")).toBe(HELPER_BYTES)
        expect(readdirSync(stepTemp)).toEqual([])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }, SUBPROCESS_TEST_TIMEOUT_MS)

    for (const [label, assets, sums] of [
      ["a tampered asset", { [KEYCHAIN_HELPER_RELEASE_ASSET]: "tampered\n" }, line(KEYCHAIN_HELPER_RELEASE_ASSET, HELPER_BYTES)],
      ["a release without the asset", {}, line("omo-linux-x64", "x")],
      ["an asset SHA256SUMS does not list", { [KEYCHAIN_HELPER_RELEASE_ASSET]: HELPER_BYTES }, line("omo-linux-x64", "x")],
    ] as const) {
      test(`refuses ${label} and installs nothing`, () => {
        const { root, result, installed, stepTemp } = restore(assets, sums)
        try {
          expect(result.status).not.toBe(0)
          expect(existsSync(installed)).toBe(false)
          expect(readdirSync(stepTemp)).toEqual([])
        } finally {
          rmSync(root, { recursive: true, force: true })
        }
      }, SUBPROCESS_TEST_TIMEOUT_MS)
    }
  })

  test("the release job uploads, restores and checksums the helper with the launchers", () => {
    const steps = jobSteps(publishWorkflow, "release")
    expect(stepAt(steps, "Download release-binary artifacts").value.with).toMatchObject({ pattern: "release-binary-*", path: ".omo/release-binaries" })
    const upload = stepAt(steps, "Upload release assets").value.run ?? ""
    expect(upload).toContain(`gh release download "v\${VERSION}" --pattern ${KEYCHAIN_HELPER_RELEASE_ASSET} --dir .omo/release-binaries`)
    expect(upload).toContain("(cd .omo/release-binaries && shasum -a 256 omo-* > SHA256SUMS)")
    expect(upload).toContain('gh release upload "v${VERSION}" .omo/release-binaries/omo-*')
  })
})
