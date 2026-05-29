export const PLANNOTATOR_REVIEW_TEMPLATE = `Run interactive visual code review. Identify all changes in git stage/working-directory or a specific PR, launch the Plannotator local browser UI, and wait for annotations.

<instructions>
1. Verify if the plannotator CLI is available on PATH.
2. If available, run "plannotator review" or "plannotator review <arguments>" using the run_command tool.
3. Provide the local browser URL to the user to let them interactively review and annotate the changes.
</instructions>`

export const PLANNOTATOR_ANNOTATE_TEMPLATE = `Annotate plans or markdown files visually. Launch the Plannotator local browser UI on the specified file and wait for interactive annotations.

<instructions>
1. Verify if the plannotator CLI is available on PATH.
2. If available, run "plannotator annotate <file>" using the run_command tool.
3. Provide the local browser URL to the user so they can interactively review, add inline strikethroughs, and save plan annotations.
</instructions>`
