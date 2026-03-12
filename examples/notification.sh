#!/bin/bash

# OpenCode notification script (compatible with Claude Code hooks)
# Usage: notification.sh <hook_type>
# Hook types: idle, permission, question

exec 2>> /tmp/opencode-notification-debug.log
echo "=== $(date) ===" >&2
echo "Hook type: $1" >&2
echo "OPENCODE_PROJECT_DIR: $OPENCODE_PROJECT_DIR" >&2

input=$(cat)
HOOK_TYPE="$1"
dir=$(basename "$OPENCODE_PROJECT_DIR")

echo "Input: $input" >&2

message=$(echo "$input" | jq -r '.message // empty' 2>/dev/null)
title=$(echo "$input" | jq -r '.title // empty' 2>/dev/null)

if [ -z "$message" ]; then
  message="Agent is ready"
fi

if [ -z "$title" ]; then
  title="OpenCode"
fi

sanitize() {
  echo "${1//;/；}"
}

send_osc_notify() {
  local title=$(sanitize "$1")
  local body=$(sanitize "$2")
  echo "Sending OSC notify: title=[$title] body=[$body]" >&2
  
  if [ -w /dev/tty ]; then
    printf '\033]777;notify;%s;%s\a' "$title" "$body" > /dev/tty
    echo "Wrote to /dev/tty" >&2
  else
    printf '\033]777;notify;%s;%s\a' "$title" "$body"
    echo "Wrote to stdout (fallback)" >&2
  fi
}

if [ ${#message} -gt 80 ]; then
  message="${message:0:77}..."
fi

case "$HOOK_TYPE" in
  "idle")
    send_osc_notify "$title ($dir)" "$message"
    if [ -f "/Users/admin/.claude/涛涛哥哥，任务已完成.wav" ]; then
      afplay "/Users/admin/.claude/涛涛哥哥，任务已完成.wav" &
    fi
    ;;
  "permission")
    send_osc_notify "$title ($dir)" "$message"
    if [ -f "/Users/admin/.claude/涛涛哥哥，任务已完成.wav" ]; then
      afplay "/Users/admin/.claude/涛涛哥哥，任务已完成.wav" &
    fi
    ;;
  "question")
    send_osc_notify "$title ($dir)" "$message"
    if [ -f "/Users/admin/.claude/涛涛哥哥，任务已完成.wav" ]; then
      afplay "/Users/admin/.claude/涛涛哥哥，任务已完成.wav" &
    fi
    ;;
  *)
    echo "Unknown hook type: $HOOK_TYPE" >&2
    exit 1
    ;;
esac
