const suffixed = await import("/home/viprix/projects/oom-wt-6142/packages/omo-opencode/src/hooks/comment-checker/pending-calls?probe")
const plain = await import("/home/viprix/projects/oom-wt-6142/packages/omo-opencode/src/hooks/comment-checker/pending-calls")
console.log("sameInstance:", suffixed.registerPendingCall === plain.registerPendingCall)
