---
description: Goal-like ultrawork loop: decompose the objective into goals with binary success criteria, then iterate until every one is proven
argument-hint: "[objective]"
---

<command-instruction>
Load and follow the `ulw-loop` skill exactly.

````text
Read ${CODEBUDDY_PLUGIN_ROOT}/skills/ulw-loop/SKILL.md in full and follow every rule in it.
````

The loop's state lives in `.omo/ulw-loop/<session>/goals.json`. Keep it updated
as goals complete; the omo Stop hook resumes the loop when a turn ends with
goals still open.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
