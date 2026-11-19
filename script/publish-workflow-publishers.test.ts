/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { type Job, publishersOf } from "./fixtures/publish-workflow-graph"

/**
 * Release contract: the publish.yml ordering rows trust publishersOf() to name every job that writes release
 * content outside the runner. A publish form it does not know would slip a job past "waits for the release tag",
 * so it must place every form publish.yml uses, and it must fail closed (report the command as unclassified)
 * on any other publish-like command or action instead of treating the job as harmless.
 */

const probe = (job: Job) => publishersOf({ jobs: { probe: job } })
const run = (command: string): Job => ({ steps: [{ name: "probe step", run: command }] })

describe("publish workflow publisher detector", () => {
  test.each([
    ["npm publish", run("npm publish --access public --provenance")],
    ["an npm dist-tag write", run('npm dist-tag add --userconfig "$NPMRC" "omo-ai@$V" beta')],
    ["a GitHub release create", run('gh release create "v${VERSION}" --title "v${VERSION}" --notes-file n.md')],
    ["a GitHub release asset upload", run('gh release upload "v${VERSION}" dist/* \\\n  --clobber')],
    ["a GitHub release delete", run("gh release delete next --yes 2>/dev/null || true")],
    ["a git push", run("git push origin HEAD:main")],
    ["a pull request create", run('gh pr create --base dev --head "$B" --title t --body b')],
    ["a workflow dispatch", run('gh workflow run publish.yml --ref "$TAG" \\\n  -f "version=${V}"')],
    ["a gh api write", run('gh api --method POST "repos/o/r/releases" -f tag_name=v1')],
    ["a gh api field write without a method", run('gh api "repos/o/r/git/refs" -f ref=refs/tags/v1 -f sha="$S"')],
    ["a reusable workflow call", { uses: "./.github/workflows/installer-mirror.yml" }],
    [
      "a push after a gh api read on one line",
      run('SHA="$(gh api repos/o/r/commits/x --jq .sha)" && git push origin "$SHA:refs/heads/x"'),
    ],
    ["a publish after a gh api read on one line", run("gh api repos/o/r --jq .x >/dev/null && npm publish")],
    ["a publish after an echo on one line", run('echo "::group::pub" && npm publish')],
    ["a gh api write fed by a pipe", run('printf "%s" "$BODY" | gh api repos/o/r/releases --input -')],
    ["a gh api write with -X glued to its method", run("gh api -XDELETE repos/o/r/git/refs/tags/v1")],
    ["a gh api write with --method=", run("gh api --method=DELETE repos/o/r/git/refs/tags/v1")],
  ] as const)("#given a job with %s #then it is a publisher", (_label, job) => {
    expect(probe(job)).toEqual({ publishers: ["probe"], unclassified: [] })
  })

  test.each([
    [
      "a third-party publish action",
      { steps: [{ name: "probe step", uses: "JS-DevTools/npm-publish@v3" }] },
      "JS-DevTools/npm-publish@v3",
    ],
    ["a script that publishes", run("bunx some-release-tool publish --yes"), "bunx some-release-tool publish --yes"],
    [
      "a registry upload by curl",
      run("curl -X PUT --data-binary @pkg.tgz https://registry.example/pkg"),
      "curl -X PUT --data-binary @pkg.tgz https://registry.example/pkg",
    ],
    ["a python package upload", run("twine upload dist/*"), "twine upload dist/*"],
    ["an image push", run("docker push ghcr.io/o/r:1"), "docker push ghcr.io/o/r:1"],
    [
      "an image push after a release read",
      run("gh release view v1 || docker push ghcr.io/o/r:1"),
      "docker push ghcr.io/o/r:1",
    ],
    ["an upload after a curl read", run("curl -s https://x && twine upload dist/*"), "twine upload dist/*"],
    [
      "a curl write with -X glued to its method",
      run("curl -XPUT https://registry.example/pkg"),
      "curl -XPUT https://registry.example/pkg",
    ],
    [
      "a curl --json write",
      run("curl --json @body.json https://registry.example/pkg"),
      "curl --json @body.json https://registry.example/pkg",
    ],
  ] as const)("#given a job with %s #then the detector fails closed on it", (_label, job, command) => {
    expect(probe(job).unclassified).toEqual([{ job: "probe", step: "probe step", command }])
  })

  test.each([
    ["an echo that mentions publishing", run('echo "Publishing ${PKG}; npm publish next"')],
    ["a commented-out publish", run("# npm publish --tag next\ntrue")],
    [
      "registry reads",
      run('npm view --json omo-ai dist-tags\ncurl -s -o /dev/null -w "%{http_code}" "https://registry.npmjs.org/x/1"'),
    ],
    [
      "GitHub release reads",
      run('gh release view "v1" >/dev/null 2>&1\ngh release list --limit 10\ngh release download v1 --pattern x'),
    ],
    [
      "gh api reads",
      run(
        'gh api "repos/o/r/collaborators/u/permission" --jq .role_name\ngh api --method GET repos/o/r/runs -f head_sha=x\ngh api -XGET repos/o/r',
      ),
    ],
    ["a quoted message with separators", run('NOTICE="publish failed; rerun: gh workflow run x.yml | tee" && true')],
    [
      "the toolchain actions",
      {
        steps: [
          { uses: "actions/checkout@v7" },
          { uses: "oven-sh/setup-bun@v2" },
          { uses: "actions/upload-artifact@v7" },
        ],
      },
    ],
  ] as const)("#given a job with %s #then it is neither a publisher nor unclassified", (_label, job) => {
    expect(probe(job)).toEqual({ publishers: [], unclassified: [] })
  })
})
