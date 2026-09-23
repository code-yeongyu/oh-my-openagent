export function reattachedTaskIds(rows, taskIds, parentSessionId) {
  const snapshots = rows.filter((row) => row.message?.role === "toolResult" &&
    row.message.toolName === "task_output" && row.message.isError !== true &&
    row.message.details?.kind === "status").map((row) => row.message.details.snapshot)
  return [...new Set(taskIds)].filter((id) => snapshots.some((snapshot) =>
    snapshot?.task_id === id && snapshot.parent_session_id === parentSessionId &&
    snapshot.status === "running" && snapshot.residency_state === "resident"))
}

export function resumeReleaseStep(session, taskIds, parentSessionId, linesBeforeResume) {
  return {
    type: "tool_call", name: "eval", arguments: {
      language: "js", summary: "verify reattachment, release children and observe completion", timeout: 1_260,
      code: `var fs = await import("node:fs");
        var ids = ${JSON.stringify(taskIds)};
        var session = ${JSON.stringify(session)};
        var acceptedIds = ${reattachedTaskIds.toString()};
        var waitForState = (path, probe, trigger = () => {}) => new Promise((resolve, reject) => {
          var cleanup = () => { clearTimeout(timer); watcher.close(); };
          var finish = () => {
            try { if (probe()) { cleanup(); resolve(); } }
            catch (error) { cleanup(); reject(error); }
          };
          var watcher = fs.watch(path, finish);
          var timer = setTimeout(() => { cleanup(); reject(new Error("reattachment observation timed out")); }, 600000);
          try { trigger(); finish(); } catch (error) { cleanup(); reject(error); }
        });
        await waitForState(session, () => {
          var rows = fs.readFileSync(session, "utf8").split("\\n").filter(Boolean).slice(${linesBeforeResume}).map(JSON.parse);
          var outputs = rows.filter(row => row.message?.role === "toolResult" && row.message.toolName === "task_output");
          if (outputs.length < ids.length) return false;
          if (acceptedIds(rows, ids, ${JSON.stringify(parentSessionId)}).length !== 4) {
            throw Object.assign(new Error("reattachment readback failed"), { code: "QA_REATTACH_READBACK" });
          }
          return true;
        });
        await waitForState(".omo/senpi-task/tasks", () =>
          ids.map(id => JSON.parse(fs.readFileSync(".omo/senpi-task/tasks/" + id + ".json", "utf8")))
            .every(record => ["completed", "error", "lost", "cancelled"].includes(record.status)),
          () => fs.writeFileSync(".omo/resume-release", "release"));`,
    },
  }
}
