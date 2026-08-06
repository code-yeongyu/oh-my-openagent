# GitHub PR Attachment Uploads

Use this reference when a PR or issue body needs screenshots or other short-lived evidence images without committing them, creating a release asset, or using an external image host.

## Contract

- Upload through GitHub's own web attachment flow and use the resulting `https://github.com/user-attachments/assets/<uuid>` URL.
- Keep temporary files under `/tmp` or an untracked evidence directory such as `.omo/evidence/...`.
- Never commit generated screenshots, terminal PNGs, upload scripts with secrets, cookies, tokens, S3 form fields, or copied request headers.
- Never use GitHub Releases for PR evidence images.
- Never use external image hosters.

## Direct Upload Flow

The flow depends on an authenticated GitHub web session, not only a `gh` API token. GitHub's same-site cookie/session requirements mean the requests must carry the browser session cookies for `github.com`, the expected same-site/referrer context, and the CSRF tokens issued for the current PR or issue page. Treat every cookie and token as a secret.

1. Open the target PR or issue page in an authenticated GitHub web session.
2. Read the page's file-attachment CSRF token and repository id from the same page/session context.
3. `POST https://github.com/upload/policies/assets` with:

```json
{
  "repository_id": "REPOSITORY_ID",
  "name": "terminal.png",
  "size": 12345,
  "content_type": "image/png",
  "authenticity_token": "FILE_ATTACHMENT_CSRF_TOKEN"
}
```

4. Upload the file bytes to S3 using the policy response's returned upload URL and form fields exactly as returned.
5. `PUT https://github.com/upload/assets/:id` with the returned `asset_upload_authenticity_token`.
6. Use only the final `https://github.com/user-attachments/assets/<uuid>` URL in the PR body.

## Secret Handling

Do not print cookies, authenticity tokens, S3 fields, authorization headers, or raw browser storage. A helper may print only the final user-attachments URL and non-secret file metadata such as filename, byte size, and content type. If a temporary script is needed, write it under `/tmp`, inspect it for accidental logging, and delete it after updating the PR body.

For PR body editing, write the body to `/tmp/pr-body.md`, inspect it, then pass it to `gh pr edit --body-file /tmp/pr-body.md`. The body should include the final attachment URLs and local evidence paths, but never the upload transaction details.

## Evidence Pattern

```markdown
## Visual Evidence

- ANSI terminal rendering: https://github.com/user-attachments/assets/<uuid>
- Long-line wrapping: https://github.com/user-attachments/assets/<uuid>
- Local evidence: `.omo/evidence/20260623-web-terminal-rendering/`
```

If the authenticated browser session is unavailable, leave the PR ready with local evidence paths and state the blocker. Do not fall back to releases or external hosting.
