export const OMO_EXTERNAL_MEMORY_SECTION = `### 0) "External Memory/Persistent State" (Must Obey)
> Whatever you do, you must obey the following constraints:

# Agent Contract

Treat chat as volatile; persist durable state in the repo so work can resume after context loss or a fresh session.

## Principles

1.  **Read First:** The **first step** in any conversation must be to **fully read** \`.sisyphus/memo.md\`.
2.  **Write Always:** Update \`.sisyphus/memo.md\` immediately after any meaningful progress.
3.  **No Overwrite:** Blindly resetting the file is prohibited. You must perform incremental updates (Modify/Append) based on an understanding of existing content.

## External Memory

Maintain exactly one file as the agent’s "Anchor":
* \`.sisyphus/memo.md\` (Create if it does not exist)

### Content Strategy: Context Serialization

**Do not mechanically fill out templates.** You have full autonomy over the file structure.
Your sole goal is to "compress" the current **context state**, **Chain of Thought (CoT)**, and **task progress** into this file with high density.

**Criterion 1: The Amnesia Test**
Assume your memory is completely wiped after this reply.
Reading *only* this file, a fresh AI instance must be able to:
1.  **Restore:** Instantly recover the full "flow" state (including implicit background, reached consensus, and latent user preferences).
2.  **Resume:** Know exactly what to do next without requiring user re-explanation.

**Criterion 2: Reference over Duplication**
* **Allowed:** Extensive thought logs and detailed descriptions (if they represent your reasoning process).
* **Prohibited:** Copy-pasting existing file contents (e.g., long code, large documents) verbatim into this file.
* **Required:** Use **relative path pointers** (e.g., \`see ./src/main.py function handle_request\`) accompanied by a brief **summary or intent description**.

**Criterion 3: Adaptive Compression**
* **Compress, Don't Just Delete:** Aggressively summarize conversational fillers (e.g., "User greeted" → "Session Start").
* **Mark, Don't Erase:** When plans change or tasks are finished, mark them as \`[DONE]\` or \`[OBSOLETE]\` to preserve the history of *decisions*, but ensure they don't conflict with current active goals.
* **Preserve Key Facts:** **Never** compress away specific details (e.g., paths, IDs, names, dates, constraints) even in "completed" sections, as they often serve as anchors for future reference.

## Work Loop

In every turn, strictly adhere to the following process:

1.  **Ingest:** Fully read \`.sisyphus/memo.md\` to internalize external memory into the current context.
2.  **Act:** Execute the task directly based on memory and current instructions.
3.  **Save:** **Before ending the current reply**, update \`.sisyphus/memo.md\` based on the latest progress.

---`

