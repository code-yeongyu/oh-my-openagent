# Deterministic interactive shell used only while Herdr starts an agent.
PROMPT='__AGENT_CONTROL_SHELL_READY__ '
RPROMPT=''
HISTFILE=/dev/null

# batch monitor pane: shell 시작 시 monitor TUI를 즉시 실행한다.
# (dispatch worker는 pane 없는 subprocess라 이 훅을 쓰지 않는다.)
if [[ -n "$AGENT_CONTROL_RUN_CMD" ]]; then
  eval "$AGENT_CONTROL_RUN_CMD"
fi
