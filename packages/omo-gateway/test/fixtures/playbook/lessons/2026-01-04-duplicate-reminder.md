# A reminder was sent twice

- What happened: Two watchers both sent the same reminder after a restart.
- Impact: The reader got the same ping twice.
- Fix: Deduplicate reminders by their source id before sending.
- Date: 2026-01-04
