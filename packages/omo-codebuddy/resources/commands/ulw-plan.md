---
description: Explore-first planning: read the omo ulw-plan skill, surface the open questions, and wait for the user's okay before writing a decision-complete plan
argument-hint: "[what to plan]"
---

<command-instruction>
Load and follow the `ulw-plan` skill exactly. Nothing else in this turn.

````text
Read ${CODEBUDDY_PLUGIN_ROOT}/skills/ulw-plan/SKILL.md in full and follow every rule in it.
````

The skill contract is binding: explore first, ask the questions that matter, and
do not produce the plan until the user says go.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
