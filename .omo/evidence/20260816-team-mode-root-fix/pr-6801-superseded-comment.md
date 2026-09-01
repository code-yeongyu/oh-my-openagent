Thank you, @ismetanin, for the detailed reproduction and for identifying the unsafe member task surface and descendant identity leak.

We rebuilt the repair against current `dev` and split the incident into the actual runtime boundaries:

- member processes now expose only member-scoped `task_send`;
- generic descendants strip member identity and `omo-member.js`;
- create and respawn share one canonical member-first extension profile;
- process models are admitted against the exact child profile before launch;
- prompt/turn failures now reach typed durable terminal outcomes.

The replacement is #6894. It includes Ivan Smetanin's authorship on the reusable boundary increment.

One correction to the original explanation: pinned Senpi does not reject the later extension wholesale when a tool name collides. The extension remains loaded and duplicate tool resolution is first-wins. The replacement therefore removes the unsafe overlapping surface without relying on whole-extension rejection as the provider-failure cause.

A follow-up issue (#6895) tracks the broader process-child resource parity contract that this incident repair deliberately does not invent.

All current review concerns were re-audited against the replacement, including direct member identity preservation, generic descendant stripping, respawn parity, model visibility, crash/restart, and lead/member delivery.

Closing this PR as superseded by #6894. Thank you again for surfacing the failure with enough detail to drive the root fix.
