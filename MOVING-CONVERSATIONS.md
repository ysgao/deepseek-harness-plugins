# Moving a conversation to another workspace

DSH has no built-in way to move an existing conversation from one workspace to
another. The UI can only re-attach a conversation to the directory it already
belongs to, so moving one means editing two pieces of on-disk state by hand:
the **workspace record** that claims the conversation, and the **transcript
header** that records which directory it ran in. Both must end up pointing at
the destination.

Follow the steps in order. Each one prevents a specific, silent failure, and
the verification in step 8 catches anything that went wrong before you restart
the app. Allow about fifteen minutes.

Paths below use `$DSH_HOME`, which defaults to `~/.dsh`.

## Before you start

- **The `zstd` CLI must be installed** (`brew install zstd`). Transcripts are
  Zstandard archives, and Node's built-in zstd reads only the first frame of
  one, so it cannot be used to check this work.
- **Know which conversation you are moving**, and the source and destination
  directories. Step 3 finds the exact ids for you.
- **The destination directory must already exist** on disk, with its real
  files in place.

## Step 1 — Create the destination workspace in DSH

With DSH running, use **Add workspace** and point it at the destination
directory. Let the app create it rather than hand-writing a record: it mints
the workspace id and the encoded session directory name, which uses a lossy
escaping scheme you should never type by hand.

Open the new workspace once so it is fully initialized, then continue.

## Step 2 — Quit DSH completely

```sh
pkill -f "dsh-app/lib/bin.js web"      # desktop app's server; adjust for your launcher
ps aux | grep "[d]sh-app/lib/bin.js"   # expect no output
```

DSH keeps workspace state in memory and writes it back on its own schedule.
Edits made while it runs are silently overwritten, so every remaining step
assumes it is stopped.

## Step 3 — Collect the ids and paths you need

List the workspaces to get the **source** and **destination** workspace ids:

```sh
python3 - <<'PY'
import json, os
d = json.load(open(os.path.expanduser('~/.dsh/storages/workspace.json')))
for wid, w in d['tables']['workspaces'].items():
    print(f"{wid}  {len(w['sessionIds']):3d} conversations  {w['path']}")
PY
```

Then identify the conversation you are moving. This prints each conversation
in the source workspace with its start date and opening message:

```sh
python3 - <<'PY'
import json, os, glob, subprocess, datetime as dt
SRC = '<source-workspace-path>'      # exact path string from the listing above
root = os.path.expanduser('~/.dsh/sessions')
for d in sorted(glob.glob(f'{root}/*/session-*/')):
    logs = sorted(glob.glob(d + 'session.v*.jsonl.zstd'))
    if not logs: continue
    lines = subprocess.run(['zstd','-dqc',logs[-1]], capture_output=True).stdout.decode().split('\n')
    try: h = json.loads(lines[0])
    except Exception: continue
    if h.get('cwd') != SRC: continue
    first = ''
    for ln in lines[1:]:
        if not ln.strip(): continue
        try: o = json.loads(ln)
        except Exception: continue
        if o.get('type') == 'user/message':
            c = (o.get('data') or {}).get('content')
            if isinstance(c, list):
                c = ' '.join(b.get('text', '') for b in c if isinstance(b, dict))
            s = ' '.join((c if isinstance(c, str) else '').split())
            if 'Current runtime context' in s or 'system-reminder' in s: continue
            first = s[:90]; break
    when = dt.datetime.fromtimestamp(h['createdAt']/1000).strftime('%Y-%m-%d')
    print(f"{os.path.basename(d.rstrip('/'))}  {when}  {first}")

PY
```

Note the **session id** of the one you want.

Finally, note the two session directory names — they are derived from each
workspace's path, so copy them from this listing rather than typing them:

```sh
ls -d ~/.dsh/sessions/*/ | grep -i <a-distinctive-word-from-each-path>
```

## Step 4 — Back up

```sh
BK=~/.dsh/_backup-$(date +%Y-%m-%d-%H%M)
mkdir -p "$BK"
cp ~/.dsh/storages/workspace.json "$BK/"
cp -R ~/.dsh/sessions/<source-project-dir>/<session-id> "$BK/"
```

These two copies are exactly what steps 5 and 6 modify, and what you restore
from if a check fails.

## Step 5 — Move the session directory

```sh
mv ~/.dsh/sessions/<source-project-dir>/<session-id> \
   ~/.dsh/sessions/<destination-project-dir>/<session-id>
```

Move it; do not copy it. The same session id present under two directories
makes the app's view of the conversation nondeterministic. A leftover
zero-byte `session.lock` inside the directory is harmless.

## Step 6 — Retarget the transcript header

A transcript is a sequence of independently compressed frames whose **first
frame must contain exactly one line**, the header. Decompressing the file,
editing line 1 and recompressing produces a single-frame file that passes
every obvious integrity check and makes the conversation vanish from the UI.

Use this script, which rewrites only the first frame and leaves every other
frame byte-identical:

```sh
cat > /tmp/retarget-cwd.py <<'PY'
import json, os, subprocess, sys

NEW   = sys.argv[1]           # new absolute cwd
MAGIC = bytes([0x28, 0xb5, 0x2f, 0xfd])

def dec(b):                   # full multi-frame decompression (CLI, not node zlib)
    r = subprocess.run(['zstd', '-dqc'], input=b, capture_output=True)
    if r.returncode != 0: raise ValueError(r.stderr.decode()[:120])
    return r.stdout

def comp(b):
    return subprocess.run(['zstd', '-q', '-c'], input=b, capture_output=True, check=True).stdout

def frames(path):
    return subprocess.run(['zstd', '-l', path], capture_output=True, text=True).stdout.split('\n')[1].split()[0]

for path in sys.argv[2:]:
    raw  = open(path, 'rb').read()
    full = dec(raw)
    nf   = frames(path)

    cut, i = None, raw.find(MAGIC, 4)
    while i != -1:
        try:
            if dec(raw[:i]) + dec(raw[i:]) == full:
                cut = i; break
        except ValueError:
            pass
        i = raw.find(MAGIC, i + 1)
    if cut is None: raise SystemExit(f'no frame boundary found in {path}')

    lines  = dec(raw[:cut]).decode().split('\n')
    h      = json.loads(lines[0]); before = h['cwd']; h['cwd'] = NEW
    lines[0] = json.dumps(h, separators=(',', ':'))
    out    = comp('\n'.join(lines).encode()) + raw[cut:]

    after = dec(out)
    lb, la = full.decode().split('\n'), after.decode().split('\n')
    assert len(lb) == len(la), f'line count drift {len(lb)} -> {len(la)}'
    diffs = [k for k in range(len(lb)) if lb[k] != la[k]]
    assert diffs == [0], f'unexpected diffs at lines {diffs[:5]}'

    open(path + '.tmp', 'wb').write(out)
    os.replace(path + '.tmp', path); os.chmod(path, 0o600)
    print(f'{path}: frames {nf} -> {frames(path)} | lines {len(la)} | cwd {before} -> {NEW}')
PY

python3 /tmp/retarget-cwd.py '<destination-directory>' \
  ~/.dsh/sessions/<destination-project-dir>/<session-id>/session.v*.jsonl.zstd
```

Run it against every `session.v*.jsonl.zstd` in the directory — older
generations carry their own header and are read by the same code. The glob
above does this for you.

The script asserts that the frame count is unchanged, the line count is
unchanged, and line 0 is the only line that differs. If any assertion trips,
restore from step 4 and do not start the app.

## Step 7 — Move the claim in `workspace.json`

```sh
python3 - <<'PY'
import json, os
P   = os.path.expanduser('~/.dsh/storages/workspace.json')
SRC = '<source-workspace-id>'
DST = '<destination-workspace-id>'
IDS = {'<session-id>'}

d  = json.load(open(P))
ws = d['tables']['workspaces']
ws[SRC]['sessionIds'] = [s for s in ws[SRC]['sessionIds'] if s not in IDS]
for s in IDS:
    if s not in ws[DST]['sessionIds']:
        ws[DST]['sessionIds'].insert(0, s)
json.dump(d, open(P, 'w'), indent=2, ensure_ascii=False)
open(P, 'a').write('\n')
print('source     :', ws[SRC]['sessionIds'])
print('destination:', ws[DST]['sessionIds'])
PY
```

Remove the id from the source list **and** add it to the destination list. A
session claimed by two workspaces stops DSH from starting at all — and it does
so only at the next cold start, so an incomplete edit here looks fine until
long after you have forgotten about it.

## Step 8 — Verify before starting the app

```sh
python3 - <<'PY'
import json, os, glob, subprocess
HOME = os.path.expanduser('~/.dsh')
d  = json.load(open(f'{HOME}/storages/workspace.json'))
ws = d['tables']['workspaces']
archived = set(d['global']['archivedSessionIds'])

errs, paths, acct = [], {}, {}
for i in d['global']['workspaceIds']:
    if i not in ws: errs.append(f'order references missing workspace {i}')
for wid, w in ws.items():
    if w['path'] in paths: errs.append(f"path {w['path']} claimed twice")
    paths[w['path']] = wid
    for s in w['sessionIds']:
        if s in acct: errs.append(f"session {s} accounted by both {acct[s]} and {wid}")
        acct[s] = wid
print('startup invariant:', 'PASS' if not errs else 'FAIL ' + '; '.join(errs))

cwds, keys = {}, {}
for f in sorted(glob.glob(f'{HOME}/sessions/*/session-*/session.v*.jsonl.zstd')):
    sid  = os.path.basename(os.path.dirname(f))
    line = subprocess.run(['zstd','-dqc',f], capture_output=True, text=True).stdout.split('\n', 1)[0]
    try:    cwds[sid] = json.loads(line)['cwd']
    except Exception: print('  ! unreadable header:', f); continue
    keys.setdefault(sid, set()).add(os.path.basename(os.path.dirname(os.path.dirname(f))))

for sid, k in keys.items():
    if len(k) > 1: print(f'  ! session {sid} exists under more than one project key: {sorted(k)}')

for wid, w in ws.items():
    live, hidden = [s for s in w['sessionIds'] if s not in archived], []
    for s in live:
        if s not in cwds:
            hidden.append((s, 'no transcript on disk'))
        elif os.path.realpath(cwds[s]) != os.path.realpath(w['path']):
            hidden.append((s, f"cwd is {cwds[s]}"))
    if hidden:
        print(f"  ! {w['path']}: {len(hidden)} of {len(live)} live conversations hidden")
        for s, why in hidden: print(f'      {s} - {why}')
print('display filter: checked')
PY
```

Expect `startup invariant: PASS` and no `!` lines. Archived conversations are
skipped on purpose: archiving may prune a transcript, so an archived id with
no log on disk is normal.

If anything is reported, restore from step 4 and start again rather than
patching the result.

## Step 9 — Start DSH and confirm

```sh
open -a /Applications/DSH.app     # or your launcher
grep -iE "inconsistent|filtered session|unavailable|error" /private/tmp/dsh_app_web.log
```

A clean move logs none of those, and the conversation appears in the
destination workspace with its history intact.

## Step 10 — Remove the source workspace (optional)

Only once the conversation is confirmed in its new home, and only through the
UI. Removing a workspace deletes the registration while retaining its
directory and every session log, so nothing is destroyed — but any
conversation still listed under it disappears from the UI, so move or keep
those deliberately first.

## If a check fails

Restore and retry; the backup from step 4 makes every step reversible.

```sh
cp "$BK/workspace.json" ~/.dsh/storages/workspace.json
rm -rf ~/.dsh/sessions/<destination-project-dir>/<session-id>
cp -R "$BK/<session-id>" ~/.dsh/sessions/<source-project-dir>/<session-id>
```

| What you see | What it means |
| --- | --- |
| `startup invariant: FAIL ... accounted by both` | Step 7 added the id without removing it from the source |
| `... live conversations hidden` with a `cwd is ...` reason | Step 6 did not run, or ran against the wrong path |
| `session ... exists under more than one project key` | Step 5 copied instead of moving |
| DSH starts with no workspaces and no working "add workspace" | A duplicate claim reached a cold start; restore `workspace.json` |
| The conversation is missing and the log says nothing | The transcript was recompressed as a single frame; restore it from the backup |

## Notes

- The conversation's content is not rewritten — only its header `cwd`. Paths
  recorded inside the transcript still refer to the old directory and still
  read correctly as history.
- Resuming a moved conversation runs it in the new directory, so it will not
  find files that exist only at the old path.
- Workspace membership has nothing to do with your profile tree
  (`cordis.yml`, `cordis.patch.yml`) or with
  `storages/session_projcache.json`. Do not edit those to fix a move.
- The scripts stay embedded in this document deliberately: a commit carrying
  them as separate files under `scripts/` would no longer be doc-only, which
  forfeits the `main` exception described in CLAUDE.md.
