# Mobius Loop

Use Mobius Loop when you want to discover what change matters, compare ways to
achieve it, and revise your approach using delivery evidence and feedback.
It implements the [Open Practice Library model](https://openpracticelibrary.com/learn/)
as a native OmO skill.

Start it in your project:

```text
/mobius-loop Reduce the time installers spend diagnosing a failed prerequisite
```

OmO records a bounded initiative with a stable name. It separates the intended
outcome from the thing being built, keeps alternatives and decision reasons, and
tracks experiments, evidence, and learning. Culture, collaboration, and technical
improvements remain visible throughout the work as Foundation.

## What to expect

The agent starts from what is already known. Missing users, measures, and
constraints remain questions rather than invented answers. Existing decisions
can be reused; there is no required workshop or fixed sequence to repeat.

Delivery uses OmO's existing execution tools. For longer work, the initiative
links to an `ulw-loop` delivery goal. Passing tests or shipping a feature can
establish delivery readiness while the intended user impact remains unmeasured.

Feedback records name their source and distinguish observation, inference, and
simulation. A simulated user response cannot establish that a real user's
outcome was achieved. An experiment that disproves an assumption can still yield
useful learning and a better next option.

Evidence determines the next move: continue delivery, revise an option, or
return to discovery. Earlier experiments and feedback remain in the record.
When measurement must wait, the agent can pause with a next action.

## Resume and finish

Initiatives live in `.omo/mobius/<slug>/initiative.json` inside the project and
are ignored by Git. They are independent of a single chat session.

```text
/mobius-loop Resume install-diagnosis
```

The agent reads the existing record before continuing. Concurrent updates are
checked against revisions so one session cannot silently replace another's work.
Use the same project directory and initiative name when resuming.

An initiative can close when its current outcomes have evidence-backed
resolutions, when evidence makes its purpose irrelevant, or when you stop it.
Stopping does not turn an unmeasured outcome into a success.

Reusable lessons can be saved through OmO's existing memory tool. Changes to
shared project rules, `AGENTS.md`, or skills remain separate reviewed changes.

## Availability and sources

Mobius Loop is bundled with native OmO. It uses the existing skill loader and
the `disabled_skills` configuration setting:

```jsonc
{
  "disabled_skills": ["mobius-loop"]
}
```

The bundled skill's `references/model.md` lists the primary sources and
attribution for its adapted model explanation, under CC BY-SA 4.0. The runtime's
records, revisions, and closure checks are OmO implementation choices.
