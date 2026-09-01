# RED -> GREEN unit captures

## RED capture (PR-head impl, before fix)
```
(pass) getSisyphusJuniorPromptSource > returns 'gpt-5-4' for GPT 5.4 models [0.04ms]
(pass) getSisyphusJuniorPromptSource > returns 'gpt-5-4' for GitHub Copilot GPT 5.4 [0.05ms]
(pass) getSisyphusJuniorPromptSource > returns 'gpt-5-5' for GPT 5.5 models [0.05ms]
(pass) getSisyphusJuniorPromptSource > returns 'gpt-5-5' for GitHub Copilot GPT 5.5 [0.04ms]
618 | 
619 |     // when
620 |     const source = getSisyphusJuniorPromptSource(model)
621 | 
622 |     // then
623 |     expect(source).toBe("gpt-5-5")
                         ^
error: expect(received).toBe(expected)

Expected: "gpt-5-5"
Received: "gpt"

      at <anonymous> (/Users/yeongyu/local-workspaces/omo/.local-ignore/worktrees/pr-6127/packages/omo-opencode/src/agents/sisyphus-junior/index.test.ts:623:20)
(fail) getSisyphusJuniorPromptSource > returns 'gpt-5-5' for GPT 5.6 models [0.10ms]
(pass) getSisyphusJuniorPromptSource > returns 'gpt' for generic GPT models [0.05ms]
(pass) getSisyphusJuniorPromptSource > returns 'gpt' for GitHub Copilot generic GPT models [0.04ms]
(pass) getSisyphusJuniorPromptSource > returns 'default' for Claude models [0.05ms]
(pass) getSisyphusJuniorPromptSource > returns 'default' for undefined model [0.03ms]
(pass) buildSisyphusJuniorPrompt > GPT 5.4 model uses GPT-5.4 optimized prompt [0.06ms]
(pass) buildSisyphusJuniorPrompt > GPT 5.5 model uses GPT-5.5 prompt [0.08ms]
(pass) buildSisyphusJuniorPrompt > generic GPT model uses generic GPT prompt [0.07ms]
(pass) buildSisyphusJuniorPrompt > Claude model prompt contains Claude-specific sections [0.04ms]
(pass) buildSisyphusJuniorPrompt > K2.7 model uses the from-scratch K2.7 prompt, not the K2.6 prompt [0.09ms]
(pass) buildSisyphusJuniorPrompt > useTaskSystem=true includes Task Discipline for GPT 5.4 [0.04ms]
(pass) buildSisyphusJuniorPrompt > useTaskSystem=true includes Task Discipline for GPT 5.5 [0.06ms]
(pass) buildSisyphusJuniorPrompt > useTaskSystem=false includes Todo_Discipline for Claude [0.05ms]

3 tests failed:
(fail) createSisyphusJuniorAgentWithOverrides > reasoning configuration > #given GPT model with reasoningEffort override only #when agent is created #then honors r

## RED capture 2 (post-merge, pre-fix impl)
```
(pass) buildSisyphusJuniorPrompt > useTaskSystem=true includes Task Discipline for GPT 5.5 [0.05ms]
(pass) buildSisyphusJuniorPrompt > useTaskSystem=false includes Todo_Discipline for Claude [0.04ms]

3 tests failed:
(fail) createSisyphusJuniorAgentWithOverrides > reasoning configuration > #given GPT model with reasoningEffort override only #when agent is created #then honors reasoningEffort without injecting variant [0.16ms]
(fail) createSisyphusJuniorAgentWithOverrides > reasoning configuration > #given GPT model with variant override only #when agent is created #then keeps default reasoningEffort [0.10ms]
(fail) createSisyphusJuniorAgentWithOverrides > reasoning configuration > #given Claude opus-4.7+ model with variant override #when agent is created #then honors variant and lets core derive effort [0.08ms]

 59 pass
 3 fail
 124 expect() calls
Ran 62 tests across 1 file. [117.00ms]

```

## GREEN capture
```
(pass) buildSisyphusJuniorPrompt > useTaskSystem=false includes Todo_Discipline for Claude [0.04ms]

 62 pass
 0 fail
 126 expect() calls
Ran 62 tests across 1 file. [115.00ms]

typecheck rc=0

```


## GREEN capture
```
(pass) buildSisyphusJuniorPrompt > useTaskSystem=false includes Todo_Discipline for Claude [0.04ms]

 62 pass
 0 fail
 126 expect() calls
Ran 62 tests across 1 file. [115.00ms]

typecheck rc=0

```
