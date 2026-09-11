# Luna 1M capability QA

- Source: the models.dev snapshot reports a 1,050,000-token context limit for
  GPT-5.6 Luna.
- Changed: the supplemental Luna Fast capability and the generated OpenCode
  capability snapshot now use the same 1,050,000-token limit.
- Test: the bundled snapshot regression test covers both Luna model IDs.
- Note: the repository test preload could not load the absent
  `@code-yeongyu/senpi` workspace package; the failure is environmental and
  unrelated to this capability assertion.
