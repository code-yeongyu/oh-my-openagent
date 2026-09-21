import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
const repo=process.cwd(), evidence=join(repo,'.omo/evidence/20260921-pr-5923');
const root=await mkdtemp(join(tmpdir(),'pr5923-codex-'));
const hash=async()=>{try{return createHash('sha256').update(await readFile(join(homedir(),'.codex/config.toml'))).digest('hex')}catch{return 'absent'}};
const before=await hash();
const env={...process.env,HOME:root,USERPROFILE:root,CODEX_HOME:join(root,'codex'),CODEX_LOCAL_BIN_DIR:join(root,'bin'),OMO_CODEX_PROJECT:join(root,'project'),QA_CWD:join(root,'project'),OMO_DISABLE_POSTHOG:'1',OMO_CODEX_DISABLE_POSTHOG:'1',OMO_CODEX_UPDATE_DISABLED:'1',OMO_CODEX_CONFIG_MIGRATION_DISABLED:'1'};
for(const p of [env.CODEX_HOME,env.QA_CWD]) await mkdir(p,{recursive:true});
let mock;
try {
 const install=spawnSync(process.execPath,['packages/omo-codex/scripts/install-local.mjs','install'],{env,encoding:'utf8',maxBuffer:20e6,timeout:180000});
 await writeFile(join(evidence,'isolated-install.txt'),install.stdout+'\n'+install.stderr);
 if(install.status!==0) throw Error('isolated install failed: '+install.status);
 mock=spawn(process.execPath,['.agents/skills/codex-qa/scripts/lib/mock-model.mjs'],{env,stdio:['ignore','pipe','pipe']});
 const port=await new Promise((ok,no)=>{let s='';mock.stdout.on('data',c=>{s+=c;const m=s.match(/MOCK_LISTENING (\d+)/);if(m)ok(m[1])});setTimeout(()=>no(Error('mock startup timed out')),10000).unref()});
 const codex=join(homedir(),'AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
 const run=await new Promise(resolveRun=>{const child=spawn(process.execPath,['.agents/skills/codex-qa/scripts/lib/app-server-client.mjs'],{env:{...env,MOCK_PORT:port,CODEX_BIN:codex,EXPECT_HOOK:'sessionStart,userPromptSubmit',PROMPT:'ulw: say hello',DEADLINE_MS:'45000'}});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('close',code=>resolveRun({code,out,err}));});
 await writeFile(join(evidence,'app-server.json'),run.out);
 await writeFile(join(evidence,'app-server-stderr.txt'),run.err);
 console.log(JSON.stringify({install:install.status,appServer:run.code,isolatedHome:env.CODEX_HOME}));
} finally {
 mock?.kill();
 const after=await hash();
 await writeFile(join(evidence,'isolation.json'),JSON.stringify({before,after,unchanged:before===after,isolatedHome:env.CODEX_HOME},null,2));
 // Keep only this task-owned sandbox for diagnosis when an installer/driver fails.
 console.log('QA sandbox: '+root);
}
