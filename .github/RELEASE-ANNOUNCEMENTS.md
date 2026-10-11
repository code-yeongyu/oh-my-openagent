# Discord release announcements

`release-announce.yml` announces published stable omo tags (`vX.Y.Z`) to
`#omo-releases`. Drafts, prereleases, and other tags are skipped. The release
body supplies the hook and up to four bold headline paragraphs. Whole paragraphs
are dropped to keep the message below 2000 characters. Mentions are disabled.

The repository secret `DISCORD_OMO_RELEASES_WEBHOOK_URL` must exist, including for
dry runs. It is passed only through the step environment and masked. Missing
credentials, empty release notes, malformed responses, and failed HTTP requests
fail the job with a tag-specific error.

The publish workflow uses its existing `GH_PAT` to create the omo GitHub release:
events created with `GITHUB_TOKEN` do not start downstream release workflows.
The announcement workflow reads the release by tag with read-only permissions
and runs the maintained script from `dev`.

## Proof commands

Print the composed message and character count without posting:

```sh
gh workflow run release-announce.yml -f tag=v5.1.29 -f dry_run=true
```

Exercise delivery without re-announcing a real version:

```sh
gh workflow run release-announce.yml -f tag=v5.1.29 -f dry_run=false -f probe=true
```

The probe posts a clearly marked pipeline check with `wait=true`, immediately
deletes that returned message ID, and requires a subsequent GET to return 404.
A failed POST, DELETE, or deletion verification makes the run red. If DELETE
fails, the test message may remain; inspect the failed run before retrying.
`dry_run=true` takes precedence over `probe=true` and never posts.

The next real release is the production proof. Do not dispatch a production
announcement for an already-announced version to prove this workflow.

## Duplicate posts

Only `published` triggers automatic announcements; editing release notes does
not. A webhook cannot list channel history, so there is no channel-history
deduplication guard. Rerunning a published-event job or dispatching with both
`dry_run=false` and `probe=false` posts again. Use dry-run or probe for checks.
