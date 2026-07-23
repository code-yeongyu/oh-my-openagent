#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
TMP_ROOT="$(node -e 'process.stdout.write(require("node:os").tmpdir())')"
RUN="$(mktemp -d "${TMP_ROOT%/}/pr6212-opencode-live.XXXXXX")"
export PATH="${HOME}/.bun/bin:${ROOT}/node_modules/.bin:${PATH}"
fake_pid="" opencode_pgid=""
owned_pids() { ps -eo pid=,args= | while read -r pid args; do case "$args" in *"$RUN"*) [ "$pid" = "$$" ] || printf '%s\n' "$pid" ;; esac; done; }
stop_owned() {
  if [ -n "$opencode_pgid" ]; then kill -TERM -- "-$opencode_pgid" 2>/dev/null || true; wait "$opencode_pgid" 2>/dev/null || true; fi
  if [ -n "$fake_pid" ]; then kill "$fake_pid" 2>/dev/null || true; wait "$fake_pid" 2>/dev/null || true; fi
  local pid; while read -r pid; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done < <(owned_pids)
}
cleanup() { set +e; stop_owned; case "$RUN" in "${TMP_ROOT%/}"/pr6212-opencode-live.*) rm -rf "$RUN" ;; esac; }
trap cleanup EXIT
for bin in opencode sqlite3 node curl rg setsid timeout; do command -v "$bin" >/dev/null || { printf 'missing dependency: %s\n' "$bin" >&2; exit 1; }; done
host_db="$(opencode db path)"; host_count() { if [ -f "$host_db" ]; then sqlite3 "file:${host_db}?mode=ro" 'SELECT count(*) FROM session'; else printf ABSENT; fi; }
host_before="$(host_count)"; opencode_version="$(opencode --version)"
export TMPDIR="$RUN/tmp" XDG_CACHE_HOME="$RUN/cache" XDG_CONFIG_HOME="$RUN/config" XDG_DATA_HOME="$RUN/data" XDG_STATE_HOME="$RUN/state"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 QA_PORT_FILE="$RUN/port" QA_FAKE_LOG="$RUN/fake.log"
mkdir -p "$TMPDIR" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME/opencode" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$RUN/project"
node --input-type=module >"$RUN/fake.stdout" 2>"$RUN/fake.stderr" <<'NODE' &
import http from "node:http"
import fs from "node:fs"
let calls=0,workerStep=0,deleteIssued=false,workerDone=false,createIssued=false,resolveWorker
const workerCompletion=new Promise((resolve)=>{resolveWorker=resolve})
const log=(event,details={})=>fs.appendFileSync(process.env.QA_FAKE_LOG,`${JSON.stringify({event,...details})}\n`)
const usage=()=>({input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}})
function send(res,events){res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache",connection:"keep-alive"});for(const event of events)res.write(`data: ${JSON.stringify(event)}\n\n`);res.end("data: [DONE]\n\n")}
function text(text){const id=`resp_${calls}`,item=`msg_${calls}`;return [{type:"response.created",response:{id,created_at:Math.floor(Date.now()/1000),model:"gpt-fake"}},{type:"response.output_item.added",output_index:0,item:{type:"message",id:item}},{type:"response.output_text.delta",item_id:item,output_index:0,delta:text},{type:"response.output_item.done",output_index:0,item:{type:"message",id:item}},{type:"response.completed",response:{usage:usage()}}]}
function tool(name,callId,args){const id=`resp_${calls}`,item=`fc_${calls}`,value=JSON.stringify(args);return [{type:"response.created",response:{id,created_at:Math.floor(Date.now()/1000),model:"gpt-fake"}},{type:"response.output_item.added",output_index:0,item:{type:"function_call",id:item,call_id:callId,name,arguments:""}},{type:"response.function_call_arguments.delta",item_id:item,output_index:0,delta:value},{type:"response.output_item.done",output_index:0,item:{type:"function_call",id:item,call_id:callId,name,arguments:value,status:"completed"}},{type:"response.completed",response:{usage:usage()}}]}
const server=http.createServer(async(req,res)=>{
  if(req.method==="GET"&&req.url==="/health"){res.writeHead(200).end("ok");return}
  if(req.method!=="POST"||!req.url?.includes("/responses")){res.writeHead(404).end();return}
  calls++;let raw="";for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),input=JSON.stringify(body.input??body.messages??body),id=input.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0]
  if(input.includes("Generate a title")){log("title");send(res,text("team lifecycle QA"));return}
  if(input.includes("TEAM_LIFECYCLE_WORKER")&&!input.includes("TEAM_LIFECYCLE_COORDINATOR")){
    const names=Array.isArray(body.tools)?body.tools.map((entry)=>entry.name).filter(Boolean):[]
    if(workerStep===0){workerStep++;log("worker-tool-map",{task:names.includes("task"),call_omo_agent:names.includes("call_omo_agent"),look_at:names.includes("look_at"),team_status:names.includes("team_status")});send(res,tool("task","denied-task",{description:"probe",prompt:"never runs",subagent_type:"explore",run_in_background:true,load_skills:[]}));return}
    if(workerStep===1){workerStep++;send(res,tool("call_omo_agent","denied-call",{description:"probe",prompt:"never runs",subagent_type:"explore"}));return}
    if(workerStep===2){workerStep++;send(res,tool("look_at","denied-look",{goal:"probe"}));return}
    if(workerStep===3){workerStep++;if(!id)throw new Error("worker request lacked team ID");log("worker-team-status",{teamRunId:id});send(res,tool("team_status","worker-status",{teamRunId:id}));return}
    if(!workerDone){workerDone=true;resolveWorker();log("worker-complete",{teamRunId:id})}send(res,text("WORKER_DONE"));return
  }
  if(input.includes("TEAM_LIFECYCLE_COORDINATOR")){
    if(!id){if(createIssued){send(res,text("COORDINATOR_ABORTED"));return}createIssued=true;log("coordinator-team-create");send(res,tool("team_create","lead-create",{inline_spec:{name:"qa-known-coordinator",lead:{name:"lead",kind:"subagent_type",subagent_type:"sisyphus"},members:[{name:"worker",kind:"subagent_type",subagent_type:"sisyphus-junior",prompt:"TEAM_LIFECYCLE_WORKER: probe team_status after denied tool calls."}]}}));return}
    if(!deleteIssued){await Promise.race([workerCompletion,new Promise((_,reject)=>setTimeout(()=>reject(new Error("worker timeout")),30000))]);deleteIssued=true;log("coordinator-team-delete",{teamRunId:id});send(res,tool("team_delete","lead-delete",{teamRunId:id,force:true}));return}
    log("coordinator-complete",{teamRunId:id});send(res,text("COORDINATOR_DONE"));return
  }
  log("default");send(res,text("DEFAULT"))
})
server.listen(0,"127.0.0.1",()=>fs.writeFileSync(process.env.QA_PORT_FILE,String(server.address().port)))
NODE
fake_pid=$!
for _ in {1..100}; do [ -s "$QA_PORT_FILE" ] && break; sleep 0.1; done
[ -s "$QA_PORT_FILE" ]; fake_port="$(<"$QA_PORT_FILE")"; curl -fsS "http://127.0.0.1:${fake_port}/health" >/dev/null
cat >"$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSON
{"plugin":["file://${ROOT}/packages/omo-opencode/src/index.ts"],"model":"openai/gpt-fake","provider":{"openai":{"options":{"apiKey":"fake-key","baseURL":"http://127.0.0.1:${fake_port}/v1","timeout":30000},"models":{"gpt-fake":{"tool_call":true,"limit":{"context":200000,"output":8192}}}}},"permission":{"bash":"allow","call_omo_agent":"allow"}}
JSON
cat >"$XDG_CONFIG_HOME/opencode/oh-my-openagent.json" <<JSON
{"disabled_hooks":["no-sisyphus-gpt"],"team_mode":{"enabled":true,"tmux_visualization":false,"base_dir":"${RUN}/teams","max_parallel_members":1,"max_members":2,"max_wall_clock_minutes":2},"agents":{"sisyphus":{"model":"openai/gpt-fake"},"sisyphus-junior":{"model":"openai/gpt-fake"}}}
JSON
setsid timeout --foreground -k 5s 90s opencode run --agent "Sisyphus - ultraworker" --model openai/gpt-fake --format json --dir "$RUN/project" --title "known coordinator lifecycle" "TEAM_LIFECYCLE_COORDINATOR: create one Sisyphus-Junior worker, wait for completion, then force-delete team." >"$RUN/events.jsonl" 2>"$RUN/opencode.stderr" &
opencode_pgid=$!; wait "$opencode_pgid"
db="$XDG_DATA_HOME/opencode/opencode.db"; lead_id="$(sqlite3 "$db" "SELECT id FROM session WHERE title='known coordinator lifecycle' ORDER BY time_created DESC LIMIT 1")"; [ -n "$lead_id" ]
member_id="$(sqlite3 "$db" "SELECT id FROM session WHERE parent_id='${lead_id}' ORDER BY time_created DESC LIMIT 1")"; [ -n "$member_id" ]
mapfile -t team_ids < <(rg -o '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}' "$QA_FAKE_LOG"); team_id="${team_ids[0]:-}"; [ -n "$team_id" ]
rg -q '"event":"coordinator-team-create"' "$QA_FAKE_LOG"; rg -q '"event":"worker-team-status"' "$QA_FAKE_LOG"; rg -q '"event":"worker-complete"' "$QA_FAKE_LOG"; rg -q '"event":"coordinator-complete"' "$QA_FAKE_LOG"
rg -q '"task":false,"call_omo_agent":false,"look_at":false,"team_status":true' "$QA_FAKE_LOG"
denied_count="$(sqlite3 "$db" "SELECT count(*) FROM part WHERE data LIKE '%Model tried to call unavailable tool%'")"; [ "$denied_count" -eq 3 ]; [ ! -e "$RUN/teams/runtime/$team_id" ]
host_after="$(host_count)"; [ "$host_before" = "$host_after" ]
stop_owned; opencode_pgid=""; fake_pid=""; [ -z "$(owned_pids)" ]; rm -rf "$RUN"; [ ! -e "$RUN" ]; trap - EXIT
printf 'RESULT=PASS opencode=%s lead=%s team=%s member=%s denied=%s host_db=%s->%s cleanup=PASS\n' "$opencode_version" "$lead_id" "$team_id" "$member_id" "$denied_count" "$host_before" "$host_after"
