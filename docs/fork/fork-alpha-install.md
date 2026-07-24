# Fork Alpha desktop install runbook

Fork-owned procedure for building a local **Fork Alpha** desktop artifact from this fork and
installing it over the running app on a Mac, with verification gates and a rollback path.

This lives under `docs/fork/` because upstream owns `docs/operations/`. Everything in `docs/fork/`
is fork-only and must never be edited by an upstream merge, so rebases never conflict here.
`docs/operations/release.md` describes upstream's CI-driven multi-platform release workflow — a
different thing, and not what this fork uses for local installs.

Last executed and verified end to end: **2026-07-24**, laptop, `0.0.28` → `0.0.29-session-import`
(commit `595442793a13`).

---

## 1. Facts and invariants

| Thing              | Value                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Fork repo          | `/Users/mimen/Programming/Repos/t3code` (`origin` = `mimen/t3code`, `upstream` = `pingdotgg/t3code`)                           |
| Installed bundle   | `/Applications/T3 Code (Fork Alpha).app`                                                                                       |
| Artifact output    | `.t3/artifacts/<label>/` (gitignored)                                                                                          |
| Electron user data | `~/Library/Application Support/t3code`                                                                                         |
| Server user data   | `~/.t3/userdata`                                                                                                               |
| State DB           | `~/.t3/userdata/state.sqlite` (+ `-wal`, `-shm`)                                                                               |
| Settings           | `~/.t3/userdata/settings.json`, `desktop-settings.json`, `client-settings.json`, `keybindings.json`, `connection-catalog.json` |
| Runtime descriptor | `~/.t3/userdata/server-runtime.json` (pid, host, port, `startedAt`)                                                            |
| Traces             | `~/.t3/userdata/logs/{desktop,server}.trace.ndjson`, `server-child.log`                                                        |
| Backend port       | `3773`                                                                                                                         |

### Bundle-identifier collision

The fork build and the official install **share bundle id `com.t3tools.t3code` and product name
`T3 Code (Alpha)`**. The `Fork Alpha` distinction exists only in the `/Applications` path — the
artifact itself extracts as `T3 Code (Alpha).app`.

Consequences:

- Both installs read and write the **same** `~/.t3/userdata` and the same Electron profile.
- Both bind port `3773`. Running them simultaneously collides on the state DB and the port.
- **Never run `/Applications/T3 Code (Alpha).app` and `/Applications/T3 Code (Fork Alpha).app` at
  the same time.**
- Address a specific install by **path** (`open -a "/Applications/T3 Code (Fork Alpha).app"`).
  AppleScript targeting by bundle id hits whichever is running — it cannot disambiguate.

### Version label and update channel

`scripts/build-desktop-artifact.ts` resolves the update channel from the version string:

- `resolveDesktopUpdateChannel` returns `nightly` only for versions matching `-nightly.YYYYMMDD.N`.
- Any other label (e.g. `0.0.29-session-import`) resolves to the **`latest`** channel, keeps
  product name `T3 Code (Alpha)`, and uses non-nightly icons.

> **Check before trusting auto-update.** A fork build carries `latest`-channel updater metadata
> while `desktop-settings.json` may persist `updateChannel: nightly` as a user setting. Confirm the
> fork install is not eligible to be auto-replaced by an upstream release before leaving a machine
> unattended for long. This has not been verified.

---

## 2. Build the artifact

Build from a **committed, pushed** SHA. The script embeds `git rev-parse --short=12 HEAD` as
`t3codeCommitHash`, which is the only reliable way to prove later what a bundle contains.

```sh
cd /Users/mimen/Programming/Repos/t3code
git status --porcelain            # must be clean for the embedded hash to mean anything
git rev-parse HEAD

node scripts/build-desktop-artifact.ts \
  --platform mac --target dmg --arch arm64 \
  --build-version 0.0.29-session-import \
  --output-dir .t3/artifacts/session-import
```

Equivalent env vars: `T3CODE_DESKTOP_PLATFORM`, `T3CODE_DESKTOP_TARGET`, `T3CODE_DESKTOP_ARCH`,
`T3CODE_DESKTOP_VERSION`, `T3CODE_DESKTOP_OUTPUT_DIR`.

`--target dmg` on macOS emits **both** dmg and zip plus blockmaps
(`scripts/build-desktop-artifact.ts:1426`). Install from the **zip** — extraction is faster than
mounting and does not attach a disk image that must be detached.

Record the hashes immediately; they are the input to every later gate:

```sh
shasum -a 256 .t3/artifacts/session-import/*.zip .t3/artifacts/session-import/*.dmg
```

---

## 3. Install

The whole procedure is: stage → verify → quit → rename → relaunch → validate. Nothing destructive
happens until staging has passed every gate.

### 3.1 Stage

Extract, then copy into `/Applications` under a **hidden, same-volume** name. Same volume matters:
the final install is then a rename, which is atomic and instant, not a 700 MB copy over a live path.

```sh
TS=$(date +%Y%m%d-%H%M%S)
rm -rf /tmp/t3-install && mkdir -p /tmp/t3-install
ditto -x -k .t3/artifacts/session-import/T3-Code-0.0.29-session-import-arm64.zip /tmp/t3-install

cp -R "/tmp/t3-install/T3 Code (Alpha).app" "/Applications/.T3 Code (Fork Alpha).app.staging-$TS"
```

### 3.2 Verify staging — all gates must pass

```sh
S="/Applications/.T3 Code (Fork Alpha).app.staging-$TS"

# version
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$S/Contents/Info.plist"

# embedded commit — must equal the SHA you built from
strings -a "$S/Contents/Resources/app.asar" | grep -oE 't3codeCommitHash[":= ]*[0-9a-f]{7,40}' | sort -u

# staging is a faithful copy of the extraction
shasum -a 256 "$S/Contents/Resources/app.asar" "/tmp/t3-install/T3 Code (Alpha).app/Contents/Resources/app.asar"
test "$(find "$S" | wc -l)" -eq "$(find "/tmp/t3-install/T3 Code (Alpha).app" | wc -l)" && echo "file count OK"

# no quarantine flag (com.apple.provenance alone is fine)
xattr -l "$S" | grep -i quarantine || echo "not quarantined"

df -h /Applications | tail -1
```

Signature check is informational only: local builds are **adhoc / linker-signed**, so
`codesign -dv` reports `Signature=adhoc` and `Sealed Resources=none`. That is expected, not a
failure.

### 3.3 Check what the running app is hosting

The desktop app supervises the server (`bin.mjs`), and the server owns any **live agent processes**.
Quitting the app kills them. Their transcripts persist and are resumable, but the UI is severed —
so look before you quit, and tell whoever is using it.

```sh
MAIN=$(pgrep -f '^/Applications/T3 Code \(Fork Alpha\).app/Contents/MacOS/T3 Code \(Alpha\)$')
SRV=$(pgrep -f 'Fork Alpha.*app.asar/apps/server/dist/bin.mjs')
ps -axo pid,ppid,etime,command | awk -v s="$SRV" '$2==s' | cut -c1-160
```

If you are running inside a Claude session, confirm your **own** ancestry is not the app you are
about to quit:

```sh
P=$$; while [ "$P" != "1" ]; do ps -o ppid=,command= -p $P | sed 's/^ *//'; P=$(ps -o ppid= -p $P | tr -d ' '); done
```

Write a handoff first if the session to be killed holds context worth keeping.

### 3.4 Quit, swap, relaunch

```sh
# graceful quit — Electron handles SIGTERM; confirm identity before signalling
kill -TERM "$MAIN"
while pgrep -f 'T3 Code \(Fork Alpha\)' > /dev/null; do sleep 0.5; done
echo "tree exited"

# atomic renames, same volume
mv "/Applications/T3 Code (Fork Alpha).app" "/Applications/T3 Code (Fork Alpha).app.preswap-$TS"
mv "$S" "/Applications/T3 Code (Fork Alpha).app"

open -a "/Applications/T3 Code (Fork Alpha).app"
```

If the second `mv` fails, immediately restore:
`mv "/Applications/T3 Code (Fork Alpha).app.preswap-$TS" "/Applications/T3 Code (Fork Alpha).app"`.

---

## 4. Validate

Run all five. Anything failing → roll back (§5) rather than debugging a half-installed machine.

**1. Version and commit**

```sh
T="/Applications/T3 Code (Fork Alpha).app"
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$T/Contents/Info.plist"
strings -a "$T/Contents/Resources/app.asar" | grep -oE 't3codeCommitHash[":= ]*[0-9a-f]{7,40}' | sort -u
```

**2. Backend up**

```sh
lsof -nP -iTCP -sTCP:LISTEN | grep ':3773'
curl -s http://127.0.0.1:3773/.well-known/t3/environment | python3 -m json.tool
cat ~/.t3/userdata/server-runtime.json                              # pid/port/startedAt current
```

`/.well-known/t3/environment` is the real readiness endpoint — it is what the desktop main process
polls via `shared.httpReadiness.waitForHttpReady` before creating the window. It returns
`environmentId`, `label`, `platform`, `serverVersion`, and `capabilities`.

Two traps here:

- **`serverVersion` is not the artifact label.** It comes from `apps/server/package.json`, which
  `--build-version` does not touch. A bundle labeled `0.0.29-session-import` correctly reports
  `"serverVersion": "0.0.28"` at commit `595442793a13`. This is not a failed swap. The embedded
  `t3codeCommitHash` is the only authoritative identity check.
- **`/api/*` paths all return 200** because the SPA catch-all serves `index.html`. A 200 there
  proves nothing beyond "web assets are served".

**3. Migrations applied on the right lineage**

```sh
sqlite3 -header -column ~/.t3/userdata/state.sqlite \
  "select * from effect_sql_migrations order by migration_id desc limit 8;"
```

Migration `33` **must** be `ProjectionThreadsSettled`. A database whose `33` is anything else came
from the collided spike branch and must never be promoted. Session-import adds `34`–`37`
(`ExternalClaudeSessions`, `ExternalClaudeSessionPrefixHash`,
`ExternalClaudeSessionTimelinePageIndexes`, `ExternalClaudeSessionTimelinePageOrderingIndexes`).

**4. Data and settings preserved**

```sh
sqlite3 ~/.t3/userdata/state.sqlite "select count(*) from projection_threads;"
cat ~/.t3/userdata/desktop-settings.json     # serverExposureMode, updateChannel, window bounds
ls -la ~/.t3/userdata/settings.json ~/.t3/userdata/keybindings.json ~/.t3/userdata/connection-catalog.json
```

**5. Renderer and IPC healthy**

```sh
osascript -e 'tell application "System Events" to tell (first process whose bundle identifier is "com.t3tools.t3code") to count windows'

python3 - <<'PY'
import json, datetime, collections
p = "/Users/mimen/.t3/userdata/logs/desktop.trace.ndjson"
cut = datetime.datetime.now().timestamp() - 900
rows = []
for line in open(p):
    try: r = json.loads(line)
    except Exception: continue
    st = r.get("startTimeUnixNano")
    if st and int(st) / 1e9 >= cut:
        rows.append((r.get("name"), r.get("exit", {}).get("_tag")))
print(len(rows), "spans;", sum(1 for _, e in rows if e != "Success"), "non-Success")
for n, c in collections.Counter(n for n, _ in rows).most_common(10): print(f"  {c:5d} {n}")
PY
```

Expect `desktop.window.createWindow`, `desktop.localEnvironmentAuth.getBearerToken`,
`desktop.ipc.connectionCatalog.get`, `desktop.ipc.clientSettings.get`, and a few hundred
`desktop.ipc.method` spans, all `Success`.

**Expected startup noise, all benign:** a burst of `http.client GET` spans against
`/.well-known/t3/environment` exiting `Failure` with `HttpClientError: Transport error`, followed by
one or two exiting `Interrupted`. That is `shared.httpReadiness.waitForHttpReady` polling the
backend while it is still binding, then being cancelled once it answers. On the 2026-07-24 laptop
install this was 14 `Failure` + 2 `Interrupted` across 13:45:17–13:45:20, with the backend ready at
13:45:21. **All of them precede `desktop.backendInstance.onReady`.** Any non-`Success` span _after_
that point is real and worth investigating.

If `desktop.lifecycle.windowAllClosed` appears with no failing span before it, the window was
closed, not crashed; `open -a` recreates it (`desktop.lifecycle.activate` → `createWindow`).

---

## 5. Rollback

The pre-swap bundle is a rename away. Keep it until validation passes.

```sh
kill -TERM "$(pgrep -f '^/Applications/T3 Code \(Fork Alpha\).app/Contents/MacOS/T3 Code \(Alpha\)$')"
while pgrep -f 'T3 Code \(Fork Alpha\)' > /dev/null; do sleep 0.5; done

mv "/Applications/T3 Code (Fork Alpha).app" "/Applications/T3 Code (Fork Alpha).app.failed-$(date +%Y%m%d-%H%M%S)"
mv "/Applications/T3 Code (Fork Alpha).app.preswap-$TS" "/Applications/T3 Code (Fork Alpha).app"
open -a "/Applications/T3 Code (Fork Alpha).app"
```

**Migrations are not rolled back by this.** Restoring an older bundle leaves the newer schema in
`state.sqlite`. If the old build cannot open the migrated DB, restore the DB from a copy taken
before the install — so take one when the version jump crosses migrations:

```sh
cp ~/.t3/userdata/state.sqlite ~/.t3/userdata/state.sqlite.pre-<label>
```

---

## 6. Cleanup

Only after validation passes:

```sh
rm -rf "/Applications/T3 Code (Fork Alpha).app.preswap-$TS"
rm -rf /tmp/t3-install
```

Keep one timestamped `.app.backup-*` for the previous good version, and keep
`.t3/artifacts/<label>/` — the zip is the only way to reinstall that exact build without rebuilding.

---

## 7. Not covered here

- **Mini server release promotion.** The Mac Mini runs a server release tree with
  `current` / `previous` symlinks pointing at `releases/<sha>`, promoted after the dedicated
  eligibility workflow passes for that exact SHA. Its paths and promotion mechanics belong with the
  `mini-remote-ops` / `mac-mini-transfer` procedures, not this runbook. The Mini's **desktop app**
  install follows §3–§6 unchanged.
- **Upstream's CI release workflow** — see `docs/operations/release.md`.
