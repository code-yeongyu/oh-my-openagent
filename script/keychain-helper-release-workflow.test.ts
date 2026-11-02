/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { load } from "js-yaml"
import { KEYCHAIN_HELPER_IDENTIFIER } from "../packages/omo-native/keychain-helper/build"
import { KEYCHAIN_HELPER_RELEASE_ASSET, KEYCHAIN_HELPER_SOURCE } from "./release-keychain-helper-target"
import { runBlock } from "./release-workflow-test-steps"
import {
  SUBPROCESS_TEST_TIMEOUT_MS,
  MATERIAL,
  HELPER_BYTES,
  readWorkflow,
  platformWorkflow,
  workflowSchema,
  jobSteps,
  stepAt,
  bash,
  helperTarball,
  withRoot,
  mode,
} from "./keychain-helper-workflow.test-support"

describe("keychain helper release workflows (#11262)", () => {
  test("every edited workflow parses as YAML into a job graph", () => {
    for (const name of ["publish-platform.yml", "publish.yml", "ci.yml"]) {
      const jobs = workflowSchema.parse(load(readWorkflow(name))).jobs
      expect(Object.keys(jobs).length, name).toBeGreaterThan(0)
    }
  })

  test("one macOS job builds, signs with the explicit identifier, notarizes and gates the helper before upload", () => {
    const workflow = workflowSchema.parse(load(platformWorkflow))
    const job = workflow.jobs["keychain-helper"]
    const steps = jobSteps(platformWorkflow, "keychain-helper")
    const build = stepAt(steps, "Build universal keychain helper")
    const sign = stepAt(steps, "Sign and notarize keychain helper")
    const verify = stepAt(steps, "Verify keychain helper signature")
    const pack = stepAt(steps, "Package keychain helper artifacts")
    const tarball = stepAt(steps, "Upload keychain helper artifact")
    const asset = stepAt(steps, "Upload keychain helper release asset artifact")

    expect(job?.["runs-on"]).toBe("macos-latest")
    expect(job?.if).toBe("github.repository == 'code-yeongyu/oh-my-openagent'")
    expect(workflow.jobs.build?.needs).toEqual(["desktop-engine", "keychain-helper"])
    expect([build.index, sign.index, verify.index, pack.index, tarball.index, asset.index]).toEqual(
      [build.index, sign.index, verify.index, pack.index, tarball.index, asset.index].slice().sort((a, b) => a - b),
    )
    expect(build.value.run).toContain('bun packages/omo-native/keychain-helper/build.ts --out "$HELPER_DIR/omo-keychain"')
    for (const name of MATERIAL) expect(sign.value.env?.[name]).toBe(`\${{ secrets.${name} }}`)
    expect(sign.value.env?.MACOS_SIGNING_REQUIRED).toBe("true")
    expect(sign.value.run).toContain(`bash .github/scripts/macos-sign-and-notarize.sh --identifier ${KEYCHAIN_HELPER_IDENTIFIER} "$KEYCHAIN_HELPER"`)
    expect(sign.value.run).not.toContain("--entitlements")
    expect(sign.value.run).not.toContain("--sign-only")
    expect(verify.value.run).toBe('bun script/keychain-helper-release.ts verify "$KEYCHAIN_HELPER"')
    expect(tarball.value.with).toMatchObject({ name: "keychain-helper", path: ".omo/keychain-helper/omo-keychain.tar.gz", "if-no-files-found": "error" })
    expect(asset.value.with).toMatchObject({ name: `release-binary-omo-keychain`, path: `.omo/release-binaries/${KEYCHAIN_HELPER_RELEASE_ASSET}`, "if-no-files-found": "error" })
  })

  test.skipIf(process.platform === "win32")("packages a mode-preserving tarball and the release asset from the signed file", () => {
    withRoot("omo-keychain-pack-", (root) => {
      const signed = join(root, "runner-temp", "omo-keychain")
      mkdirSync(join(root, "runner-temp"), { recursive: true })
      writeFileSync(signed, HELPER_BYTES)
      chmodSync(signed, 0o644)
      const result = bash(runBlock(platformWorkflow, "      - name: Package keychain helper artifacts\n", "      - name: Upload keychain helper artifact\n"), root, { KEYCHAIN_HELPER: signed })
      expect(result.status, String(result.stderr)).toBe(0)

      const extracted = join(root, "extracted")
      mkdirSync(extracted)
      expect(spawnSync("tar", ["-xzpf", join(root, ".omo/keychain-helper/omo-keychain.tar.gz"), "-C", extracted]).status).toBe(0)
      expect(mode(join(extracted, "omo-keychain"))).toBe(0o755)
      expect(readFileSync(join(root, ".omo/release-binaries", KEYCHAIN_HELPER_RELEASE_ASSET), "utf8")).toBe(HELPER_BYTES)
    })
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  test.skipIf(process.platform === "win32")("darwin build legs stage the helper for the compiled payload and the platform package before both builds", () => {
    const steps = jobSteps(platformWorkflow, "build")
    const launcher = stepAt(steps, "Build launcher")
    const download = stepAt(steps, "Download keychain helper")
    const stage = stepAt(steps, "Stage keychain helper")
    const compile = stepAt(steps, "Build release binary")
    const compress = stepAt(steps, "Compress binary")
    const darwinGate = "startsWith(matrix.platform, 'darwin-') && (steps.release-assets.outputs.binary_exists != 'true' || steps.check.outputs.skip != 'true')"

    expect(launcher.index).toBeLessThan(download.index)
    expect(download.index).toBeLessThan(stage.index)
    expect(stage.index).toBeLessThan(compile.index)
    expect(stage.index).toBeLessThan(compress.index)
    expect(download.value.if).toBe(darwinGate)
    expect(stage.value.if).toBe(darwinGate)
    expect(download.value.with).toEqual({ name: "keychain-helper", path: ".omo/keychain-helper" })

    const script = runBlock(platformWorkflow, "      - name: Stage keychain helper\n", "      - name: Build release binary\n")
    for (const packageSkip of ["false", "true"]) {
      withRoot("omo-keychain-stage-", (root) => {
        helperTarball(root)
        const result = bash(script, root, { PLATFORM: "darwin-arm64", PACKAGE_SKIP: packageSkip })
        expect(result.status, String(result.stderr)).toBe(0)
        expect(mode(join(root, KEYCHAIN_HELPER_SOURCE))).toBe(0o755)
        const packaged = join(root, "packages/oh-my-opencode-darwin-arm64/bin/omo-keychain")
        expect(existsSync(packaged)).toBe(packageSkip === "false")
        if (packageSkip === "false") {
          expect(mode(packaged)).toBe(0o755)
          expect(readFileSync(packaged, "utf8")).toBe(HELPER_BYTES)
        }
      })
    }
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  test("the native darwin smoke checks the provisioned helper against its requirement", () => {
    const smoke = stepAt(jobSteps(platformWorkflow, "build"), "Smoke test release binary").value.run ?? ""
    expect(smoke).toContain('local helper="${HOME}/.omo/binary-runtime/${OMO_AI_VERSION}/omo-keychain"')
    expect(smoke).toContain('bun script/keychain-helper-release.ts verify "$helper"')
    expect(smoke).toMatch(/darwin-arm64\)\n(?:.*\n)*?\s+assert_first_run_provisioned\n\s+assert_keychain_helper_provisioned\n/)
  })
})
