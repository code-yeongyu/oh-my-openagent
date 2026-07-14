#!/usr/bin/env bash
# MaTrix Architect — Full auto-evolution cycle (cron entry point).
# Runs every 4h: collect error signals -> run L1 engine -> scan sessions
# for patterns -> check OMO upstream. Logs to .matrix/logs/architect-cycle.log.
set -uo pipefail

cd /home/shiro
LOG="/home/shiro/.matrix/logs/architect-cycle.log"
SCRIPT_DIR="/home/shiro/matrix-port/architect"

echo "=== Architect cycle $(date -u) ===" >> "$LOG"
bash "$SCRIPT_DIR/collect-errors.sh" >> "$LOG" 2>&1
bun run "$SCRIPT_DIR/run-engine.ts" >> "$LOG" 2>&1
bun run "$SCRIPT_DIR/apply-learnings.ts" >> "$LOG" 2>&1
bun run "$SCRIPT_DIR/dispatch-fix-tasks.ts" >> "$LOG" 2>&1
bash "$SCRIPT_DIR/scanner.sh" >> "$LOG" 2>&1
echo "=== cycle done $(date -u) ===" >> "$LOG"
