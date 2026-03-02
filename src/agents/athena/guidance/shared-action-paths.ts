export const EXECUTION_AGENT_OPTIONS = `\
      { label: "Hephaestus", description: "Direct implementation with Hephaestus" },
      { label: "Sisyphus", description: "Implementation with Sisyphus" },
      { label: "Sisyphus ultrawork", description: "Implementation with Sisyphus using ultrawork mode" }`

export const WRITE_DOCUMENT_OPTION =
  '      { label: "Write to document", description: "Save to .sisyphus/athena/notes/ (named after this council session)" }'

export const DONE_OPTION =
  '      { label: "Done", description: "No further action needed" }'

export const DONE_QUESTION_TAIL = `\
${DONE_OPTION}
    ],
    multiple: false
  }]
})`

export const WRITE_DOCUMENT_ACTION =
  '- Write to document -> write the document to the ".sisyphus/athena/notes/" directory using the council session name from the council_finalize archive_dir, then report the exact path.'

export const ASK_FOLLOWUP_ACTION =
  "- Ask follow-up -> ask user then restart the council workflow from Step 3 (intent classification)."

export const DONE_ACTION = "- Done -> acknowledge and end."

export const COMMON_ACTION_TAIL = `${WRITE_DOCUMENT_ACTION}
${ASK_FOLLOWUP_ACTION}
${DONE_ACTION}`

export const FOLLOWUP_OR_DONE_QUESTION_BODY = `\
    header: "Next Step",
    options: [
      { label: "Ask follow-up", description: "Ask a clarifying question and run another council pass" },
${DONE_QUESTION_TAIL}`

export const EXECUTION_AGENT_QUESTION_BODY = `\
    header: "Execution Agent",
    options: [
${EXECUTION_AGENT_OPTIONS}
    ],
    multiple: false
  }]
})`
