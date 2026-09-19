---
description: Hypothesis-driven debugging loop that escalates to orthogonal oracles and locks the fix with a failing test
argument-hint: "[symptom or failing command]"
---

<command-instruction>
Load and follow the `debugging` skill exactly.

````text
Read ${CODEBUDDY_PLUGIN_ROOT}/skills/debugging/SKILL.md in full and follow every rule in it.
````

Reproduce before you theorize; every hypothesis gets an experiment that can
falsify it; the fix ships with the test that failed before it.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
