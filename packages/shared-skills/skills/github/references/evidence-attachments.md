# PR body evidence attachments

When a PR body needs screenshots or terminal PNGs, host them as GitHub user attachments. Never commit temporary images, never use GitHub Releases for PR evidence, and never use external image hosts.

Uploading needs an authenticated GitHub web session (drive it with the `browser` skill); an API token alone is not enough. No token, cookie, form field or upload header may reach tool output, so the whole upload runs inside ONE in-page script that returns only the final asset URL:

1. Open the target PR or issue page in the signed-in session.
2. Run one page-context script that takes the image bytes (base64) plus file name and content type, and inside the page:
   - reads the page's file-attachment CSRF token and repository id from the DOM,
   - `POST https://github.com/upload/policies/assets` (`repository_id`, `name`, `size`, `content_type`, the token as `authenticity_token`),
   - uploads the bytes to the returned S3 URL with the returned form fields exactly as given,
   - `PUT https://github.com/upload/assets/:id` with the returned `asset_upload_authenticity_token`,
   - returns only the `https://github.com/user-attachments/assets/<uuid>` URL (or an error string without any header, token or form value).
3. Put that URL in the PR body through `pr.edit` (read the body back with `pr.view` first so the edit keeps everything else).

Never split these steps across calls, never print an intermediate response, and never log the script's inputs beyond the file name. If no authenticated browser session is available, leave the local evidence paths in the PR body and state the blocker.
