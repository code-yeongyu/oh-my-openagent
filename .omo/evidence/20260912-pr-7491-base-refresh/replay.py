#!/usr/bin/env python3
"""Real native launcher diagnostic QA; synthetic stores, no inherited credentials."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
SANDBOX = OUT / 'sandbox'
NODE = os.environ.get('QA_NODE') or shutil.which('node')
BUN = os.environ.get('QA_BUN') or shutil.which('bun')
assert NODE and BUN, 'Node and Bun must be available'
BUN_DIR = str(Path(BUN).resolve().parent)
LAUNCHER = REPO / 'packages/omo-native/bin/omo.js'
REQUEST = '01a048ce-c465-776b-959c-dcb362446db7'
HEADER = '01a0464c-0661-73a1-8d6c-cc1df9f27972'
REAL_HOME = Path.home()

def redact(text):
    for source, target in [(str(OUT), '<evidence>'), (str(REPO), '<worktree>'),
                           (NODE, '<node>'), (BUN_DIR, '<bun-install>'),
                           (str(REAL_HOME), '<real-home>')]:
        text = text.replace(source, target)
    return text

def hashes():
    paths = [REAL_HOME / d / f for d in ['.omo/agent', '.senpi/agent']
             for f in ['settings.json', 'auth.json', 'models.json', 'models-store.json', 'mcp.json', 'trust.json']]
    paths += [REAL_HOME / '.omo/omo.json', REAL_HOME / '.omo/omo.jsonc', REAL_HOME / '.codex/config.toml']
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None for p in paths}

def session(agent, directory, filename, header):
    p = agent / 'sessions' / directory / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({'type': 'session', 'version': 3, 'id': header,
                            'timestamp': '2026-09-12T00:00:00.000Z', 'cwd': '/synthetic-project'}) + '\n')
    return p

before = hashes()
results = []
try:
    for runtime in ['node', 'bun']:
        for case in ['mismatch', 'partial', 'ambiguous', 'indexed', 'session-dir', 'env-session-dir',
                     'separator', 'prompt-session-dir', 'path', 'engine-rejection', 'version']:
            root = SANDBOX / runtime / case
            home = root / 'home'
            agent = home / "agent $state's"
            home.mkdir(parents=True, exist_ok=True)
            file = session(agent, 'first', f'2026-09-12T00-00-00-000Z_{REQUEST}.jsonl', HEADER)
            env = {'PATH': f'{BUN_DIR}:{Path(NODE).resolve().parent}:/usr/bin:/bin',
                   'HOME': str(home), 'USERPROFILE': str(home), 'TMPDIR': str(root / 'tmp'),
                   'OMO_RUNTIME': runtime, 'BUN_INSTALL': str(home / '.bun'),
                   'OMO_CODING_AGENT_DIR': str(agent), 'SENPI_CODING_AGENT_DIR': str(agent),
                   'PI_CODING_AGENT_DIR': str(agent), 'CODEX_HOME': str(home / '.codex'),
                   'OMO_DISABLE_TELEMETRY': '1', 'DO_NOT_TRACK': '1', 'NO_COLOR': '1',
                   'TERM': 'dumb', 'OMO_SEND_ANONYMOUS_TELEMETRY': '0'}
            for kind in ['DATA', 'CONFIG', 'CACHE', 'STATE']:
                env[f'XDG_{kind}_HOME'] = str(home / ('xdg-' + kind.lower()))
            Path(env['TMPDIR']).mkdir(parents=True, exist_ok=True)
            args = ['--session', REQUEST, '--version']
            expected = case in ['mismatch', 'partial', 'prompt-session-dir', 'engine-rejection']
            if case == 'partial': args = ['--session', REQUEST[:8], '--version']
            if case == 'ambiguous':
                session(agent, 'second', '2026-09-12T00-00-00-000Z_01a048ce-other.jsonl', HEADER + '0')
                args = ['--session', REQUEST[:8], '--version']
            if case == 'indexed': session(agent, 'second', 'plain.jsonl', REQUEST)
            if case == 'session-dir': args += ['--session-dir', str(root / 'custom-sessions')]
            if case == 'env-session-dir': env['OMO_CODING_AGENT_SESSION_DIR'] = str(root / 'custom-sessions')
            if case == 'separator': args = ['--version', '--', '--session', REQUEST]
            if case == 'prompt-session-dir': args += ['--', '--session-dir', 'prompt-only']
            if case == 'path': args = ['--session', str(file), '--version']
            if case == 'engine-rejection': args = ['--session', REQUEST, '--print', '--no-extensions', '--no-skills']
            if case == 'version': args = ['--version']
            command = [NODE, str(LAUNCHER), *args]
            completed = subprocess.run(command, cwd=root, env=env, input='', text=True,
                                       capture_output=True, timeout=45)
            (OUT / f'{runtime}-{case}.stdout.txt').write_text(redact(completed.stdout))
            (OUT / f'{runtime}-{case}.stderr.txt').write_text(redact(completed.stderr))
            diagnostic = 'omo: candidate ' in completed.stderr
            record = {'case': case, 'runtime': runtime, 'command': command, 'cwd': str(root),
                      'home': str(home), 'agentDir': str(agent), 'exit': completed.returncode,
                      'diagnostic': diagnostic, 'expectedDiagnostic': expected,
                      'environmentKeys': sorted(env), 'inheritedEnvironment': False}
            results.append(record)
            assert diagnostic == expected, record
            assert completed.returncode == (1 if case == 'engine-rejection' else 0), record
            if case == 'engine-rejection':
                assert f"No session found matching '{REQUEST}'" in completed.stderr, record
            if case in ['mismatch', 'partial']:
                quoted = "'" + str(file).replace("'", "'\\''") + "'"
                assert quoted in completed.stderr, record
    print(f'PASS: {len(results)} real launcher runs; Node and Bun paths; engine rejection confirmed.')
finally:
    after = hashes()
    receipt = {'results': results, 'protectedBefore': before, 'protectedAfter': after,
               'protectedConfigsUnchanged': before == after, 'realHomesExcludedFromChildEnv': True,
               'platform': os.uname().sysname, 'windowsExecutionTested': False,
               'sandbox': str(SANDBOX), 'note': 'No inherited credentials; synchronous child exit awaited with bounded timeout. Existing real sessions are not read. Sandbox retained as synthetic evidence.'}
    (OUT / 'native-qa.json').write_text(redact(json.dumps(receipt, indent=2)) + '\n')
    assert before == after, 'Protected real configuration changed during QA'
