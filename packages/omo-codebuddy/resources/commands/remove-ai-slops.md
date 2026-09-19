---
description: Remove AI-generated code smells from the branch's changes behind regression tests, with an atomic commit per cleanup
argument-hint: "[branch or file scope]"
---

<command-instruction>
Load and follow the `remove-ai-slops` skill exactly.

````text
Read ${CODEBUDDY_PLUGIN_ROOT}/skills/remove-ai-slops/SKILL.md in full and follow every rule in it.
````

Every removal must be covered by a test that was passing before and after. No
opportunistic refactors outside the cleanup scope.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
