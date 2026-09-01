export const GPT_APPLY_PATCH_GUIDANCE =
  "Use `apply_patch` for file edits. Keep patches small and match the surrounding lines exactly so verification passes."

export const GPT_FILE_EDIT_GUIDANCE =
  "Use whichever file-editing tool is exposed in your toolset (`apply_patch`, or `edit`/`write`). Keep each change small and match the surrounding lines exactly so it applies on the first attempt."
