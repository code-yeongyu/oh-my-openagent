#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createThreadComponent } from "../../src/components/thread/component.ts"
const root = mkdtempSync(join(tmpdir(), "omo-thread-plugin-surface-")); const tools=[]; const warnings=[]
const pi={cwd:root,rpc:{emit(){},handle(){}},registerTool(t){tools.push(t)},on(){},registerCommand(){},registerFlag(){},getFlag(){return undefined},sendMessage(){},sendUserMessage(){}}
createThreadComponent({host:{socket:"qa",listSessions:async()=>[],openSession:async()=>({sessionId:"s",cwd:root}),getMessages:async()=>[],getState:async()=>({}),prompt:async()=>({}),interrupt:async()=>({})},stateDirectory:join(root,"state")}).register(pi,{logger:{info(){},error(){},warn(x){warnings.push(x)}},config:{getFlag(){return undefined}}})
if(tools.length!==6) throw new Error(`expected six tools, got ${tools.length}`)
if(tools.filter(t=>Array.isArray(t.promptGuidelines)).length!==1) throw new Error("expected one guidelines entry")
console.log(`PASS plugin-surface tools=${tools.map(t=>t.name).join(',')} guidelines=1`)
rmSync(root,{recursive:true,force:true})
