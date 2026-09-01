const skillContent = await Bun.file(".opencode/skills/work-with-pr/SKILL.md").text()
const delegatesThroughGitMaster = skillContent.includes("commits through `git-master`")
expect(delegatesThroughGitMaster).toBe(true)
expect(skillContent).not.toContain(
  'task(category="quick", load_skills=["git-master"], prompt="Commit the changes atomically following git-master conventions.")',
)
const usesRealToolNames =
  skillContent.includes('task_create(subject="Triage: #{number} {title}")')
  && skillContent.includes('task_update(id=task_id, status="completed")')
expect(usesRealToolNames).toBe(true)
