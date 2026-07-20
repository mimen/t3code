# Claude session browsing/import/resume spike

Date: 2026-07-19

Branch: `spike/session-import`

Upstream: `pingdotgg/t3code`

## Executive summary

The spike proves that a T3 thread can continue an arbitrary Claude Code session that was created outside T3, provided T3 starts Claude with the external session UUID as the Agent SDK `resume` option and launches it from the cwd that maps to the session's `~/.claude/projects/<encoded-cwd>/` store.

The imported T3 thread was `7260d0c5-4e99-4707-8378-f8fba657adb8`; its resume cursor referenced external Claude session `0af38204-088d-40d7-a2ea-c3ba44441ce0`. The server trace recorded both `claude.resume.source="resume-session"` and `claude.query.resume="0af38204-088d-40d7-a2ea-c3ba44441ce0"`. Claude then emitted `thread.started` and `system:init` events carrying that same external session ID. A live user turn was accepted and reached the provider, which returned the current account session-limit message. Capacity prevented a semantic answer, but the session ID, provider events, and provider-generated limit response prove that execution reached the resumed Claude path rather than creating a fresh T3-owned session.

Recommended product architecture:

1. Treat `~/.claude/projects/**/*.jsonl` as the authoritative source for a separate, read-only Claude-history browser.
2. Parse/index metadata incrementally, but load full transcript detail on demand.
3. Import only when the user chooses **Continue in T3**; create a normal T3 thread, record provenance, and seed the provider resume cursor.
4. Keep CCS optional: use it as an enrichment/action adapter where installed, never as the correctness-critical source.
5. Backfill historical messages only as a later normalization step into T3's canonical projections; do not introduce a second timeline model inside `ChatView`.

## 1. T3 session/thread SQLite model and file locations

### Database location

Server state is under the configured base directory:

- `<baseDir>/dev/state.sqlite` when the resolved server base is an implicit dev URL.
- `<baseDir>/userdata/state.sqlite` otherwise.

The same state directory contains attachments and logs. Path construction is in `apps/server/src/config.ts:95-123`. SQLite creates the parent directory, opens the configured path, enables foreign keys and WAL, and applies migrations in `apps/server/src/persistence/Layers/Sqlite.ts:33-68`.

The empirical spike used:

```text
/private/tmp/t3-spike-home/userdata/state.sqlite
/private/tmp/t3-spike-home/userdata/state.sqlite-wal
/private/tmp/t3-spike-home/userdata/state.sqlite-shm
```

### Project/thread/message projections

T3 uses orchestration events plus read-optimized projection tables rather than storing a provider transcript as one opaque session blob.

The principal tables are defined in `apps/server/src/persistence/Migrations/005_Projections.ts:7-153`:

| Table                              | Purpose                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `projection_projects`              | Project identity, title, `workspace_root`, repository identity, defaults, timestamps/deletion.                                |
| `projection_threads`               | T3 thread identity, owning project, title, model selection JSON, runtime/interaction mode, branch/worktree, archive/deletion. |
| `projection_thread_messages`       | Canonical user/assistant messages keyed to a T3 thread, with optional turn ID, text, streaming state, and timestamps.         |
| `projection_thread_sessions`       | Current projected provider session status, provider/instance identity, runtime mode, active turn, and last error.             |
| `projection_turns`                 | Turn lifecycle and associated execution/checkpoint information.                                                               |
| `projection_thread_activities`     | Tool/activity timeline records.                                                                                               |
| `projection_thread_proposed_plans` | Proposed plan state.                                                                                                          |
| `projection_pending_approvals`     | Approval state.                                                                                                               |

Message attachments were added in `apps/server/src/persistence/Migrations/007_ProjectionThreadMessageAttachments.ts:4-11`; thread shell-summary fields are in `apps/server/src/persistence/Migrations/023_ProjectionThreadShellSummary.ts:4-26`.

Message persistence is explicitly thread-scoped. Reads order by `created_at, message_id`, and writes/upserts use `thread_id`; see `apps/server/src/persistence/Layers/ProjectionThreadMessages.ts:46-94` and `apps/server/src/persistence/Layers/ProjectionThreadMessages.ts:119-168`.

### Provider runtime binding and resume cursor

Provider continuity is stored separately from the UI projection in `provider_session_runtime`, created by `apps/server/src/persistence/Migrations/004_ProviderSessionRuntime.ts:4-29`.

It is one row per T3 thread:

```sql
CREATE TABLE provider_session_runtime (
  thread_id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  adapter_key TEXT NOT NULL,
  runtime_mode TEXT NOT NULL DEFAULT 'full-access',
  status TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resume_cursor_json TEXT,
  runtime_payload_json TEXT,
  provider_instance_id TEXT
);
```

The repository shape and serialization are in `apps/server/src/persistence/ProviderSessionRuntime.ts:35-52` and `apps/server/src/persistence/ProviderSessionRuntime.ts:150-225`.

For the spike, the important cursor was equivalent to:

```json
{
  "threadId": "7260d0c5-4e99-4707-8378-f8fba657adb8",
  "resume": "0af38204-088d-40d7-a2ea-c3ba44441ce0",
  "turnCount": 3
}
```

A required invariant is that `provider_instance_id` matches the thread's selected instance. `ProviderService` only reuses a stored cursor when `persistedBinding.providerInstanceId === resolvedInstanceId`; see `apps/server/src/provider/Layers/ProviderService.ts:562-600`. The initial spike wrote `null`, which could cause a fresh session on a clean reproduction. This report's validation pass fixed that clear spike-local defect by persisting the branded `ProviderInstanceId.make("claudeAgent")` in both the thread model selection and runtime row.

## 2. Exact Claude resume mechanics

### T3 flow

1. The importer extracts the external Claude `sessionId` and original `cwd` from its JSONL, creates/reuses a T3 project for that cwd, creates a normal T3 thread, and writes the external session UUID into `provider_session_runtime.resume_cursor_json`: `apps/server/src/cli/sessionImport.ts:54-127` and `apps/server/src/cli/sessionImport.ts:173-239`.
2. The orchestration reactor derives the provider cwd from the project/thread worktree and starts or restarts the provider session: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:468-485` and `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:514-583`.
3. `ProviderService` resolves the selected provider instance and reuses the persisted resume cursor only when its instance binding matches: `apps/server/src/provider/Layers/ProviderService.ts:562-600`.
4. The Claude adapter accepts `resume` (or legacy `sessionId`) from the generic cursor, validates it as a UUID, and retains the T3 thread ID, optional resume point, and turn count: `apps/server/src/provider/Layers/ClaudeAdapter.ts:562-597`.
5. The adapter calls the Claude Agent SDK with:
   - `cwd: input.cwd`
   - `additionalDirectories: [input.cwd]`
   - `resume: existingResumeSessionId` when resuming
   - otherwise a newly generated `sessionId`

   See `apps/server/src/provider/Layers/ClaudeAdapter.ts:3443-3481`.

6. Native SDK messages carrying a durable `session_id` update the adapter's in-memory resume state and are persisted back into the runtime cursor for later turns: `apps/server/src/provider/Layers/ClaudeAdapter.ts:1447-1465`, `apps/server/src/provider/Layers/ClaudeAdapter.ts:1646-1682`, and `apps/server/src/provider/Layers/ClaudeAdapter.ts:2537-2543`.

The installed Agent SDK describes `Options.resume` as “Session ID to resume. Loads the conversation history from the specified session” at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1764-1767`. `Options.cwd` defaults to `process.cwd()` at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1347-1354`.

### Can arbitrary external Claude IDs resume?

Yes, locally stored external Claude Code sessions can resume even if T3 did not create them. The SDK/CLI resume value is a Claude session UUID, not a T3 thread ID and not a foreign key into T3's database. The empirical session was located at:

```text
/Users/mimen/.claude/projects/-Users-mimen-Programming-Repos/0af38204-088d-40d7-a2ea-c3ba44441ce0.jsonl
```

T3 supplied that external ID verbatim, and Claude emitted the same ID in `thread.started`, `system:init`, status, rate-limit, assistant, and result events.

“Arbitrary” is bounded by local availability and validity:

- The value must be a valid Claude session UUID.
- The corresponding transcript/session state must exist in the local Claude store visible to the server process.
- The server process must run as a user with access to that store and the Claude account/authentication needed to continue it.
- The launch cwd must map to the transcript's Claude project storage folder.
- A session created on another machine is not resumable merely from its UUID; its local session files must first be present on this machine.

### Cwd coupling

Cwd is load-bearing, not cosmetic.

Claude Code stores sessions under a directory derived from cwd, and `--continue` is explicitly “the most recent conversation in the current directory.” Although `--resume <uuid>` names the session directly, the resume process still needs to launch from the directory that maps to the session's storage folder so project settings, repository context, and session lookup agree.

T3 preserves that relationship by creating/reusing a project whose `workspaceRoot` equals the JSONL `cwd`, then passing the derived project/worktree cwd to the adapter. If the thread later moves to a worktree or another cwd, the reactor may restart the provider session with the new cwd; that behavior is in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:468-485`.

CCS independently encodes the same constraint: it constructs `claude --resume <id>` and runs it in the recorded session cwd, describing that as the way to sidestep the cwd-scoped picker. It verifies that the cwd's encoded realpath matches the transcript's storage folder and attempts recovery if the path moved: `/Users/mimen/Programming/Repos/claude-sessions/src/resume/command.ts:15-43` and `/Users/mimen/Programming/Repos/claude-sessions/src/resume/command.ts:52-90`.

Practical rule: import the JSONL's actual `cwd`, do not infer it by reversing the encoded directory name, and surface a blocking warning if that cwd no longer exists or no longer maps to the transcript path.

## 3. Architecture: browse everything vs import/continue on demand

These are two different product capabilities and should remain separate.

### A. Read-only Claude history browser

Purpose: discover and inspect every local Claude Code session without changing T3's orchestration state.

Recommended server module boundary:

- `ClaudeSessionStore`: locates configured roots (default `~/.claude/projects`), streams JSONL safely, and returns source metadata.
- `ClaudeSessionCatalog`: incremental metadata/index layer keyed by Claude session ID plus source path. Store cwd, timestamps, first prompt/title, message counts, parent/subagent relation, branch, file mtime/size, and resolved resume ID.
- `ClaudeTranscriptReader`: parses one selected session on demand into a read-only normalized view. It should preserve human/assistant text and optionally expose tool activity, but it must not emit orchestration commands.
- `ClaudeSessionWatch`: optional filesystem watcher/poller that invalidates metadata when JSONL mtime/size changes. Correctness must not depend on the watcher; refresh-on-open remains authoritative.
- Read-only HTTP/RPC endpoints for list/search/detail. Keep them outside `OrchestrationEngine` command dispatch because browsing is not a T3 state mutation.

Operational requirements:

- Recursively discover `*.jsonl`, including subagent directories.
- Stream line-by-line; transcripts can be tens of MB and may be actively appended.
- Tolerate malformed/truncated final lines and unknown record types.
- Use each record's `cwd`; encoded folder names are lossy and not safely reversible.
- Distinguish human user turns from tool-result `type:"user"` records.
- Treat source content as untrusted display data. Never execute transcripted tool calls.
- Redact or gate potentially sensitive tool results in previews.
- Detect duplicate/resumed files using the internal resume/session ID rather than filename alone.
- Support explicit rescan and show index freshness/source host.

Do **not** create one T3 project/thread for every JSONL. That would pollute the sidebar, duplicate data, imply that T3 owns sessions it only discovered, and make sync/idempotency significantly harder.

### B. On-demand import and live continuation

Purpose: convert one selected external session into a normal T3 thread capable of accepting turns.

Recommended operation:

1. User selects **Continue in T3** from a read-only external-session detail page.
2. Server revalidates source path, session ID, cwd, and current mtime/size.
3. Resolve or ask for the target T3 project when cwd does not exactly match an active project.
4. Create the T3 thread with explicit provenance metadata.
5. Seed `provider_session_runtime` with the external session ID, matching `providerInstanceId`, runtime mode, and turn count.
6. Start the first turn through the existing `thread.turn.start` path.
7. Once Claude emits `system:init`, verify that returned `session_id` equals the requested external ID. If not, stop and surface a resume failure rather than silently continuing a fresh session.

Idempotency should be based on `(provider instance, external session ID, source host)` and offer **Open existing imported thread** instead of creating duplicates.

### Historical message backfill

The current spike does not backfill historical messages. There are two viable product stages:

- **Initial ship:** read-only external detail remains the historical transcript; imported T3 thread begins with an import marker and only new T3 turns appear in the canonical timeline.
- **Later normalization:** convert selected JSONL human/assistant messages and tool activities into T3 projection-compatible import events. Preserve source IDs/provenance and mark them immutable/imported. This should happen through a dedicated import event/command or idempotent projection importer, not direct ad-hoc writes to projection tables.

Backfill must decide how to represent sidechains, tool results, streaming fragments, synthetic/system records, attachments, and message parentage. It is substantially larger than resume-cursor import.

## 4. UI integration and recommended UX

### Existing integration points

- Sidebar project/thread list: `apps/web/src/components/Sidebar.tsx:321-435` and `apps/web/src/components/Sidebar.tsx:939-1063`. It already groups threads, derives cwd/worktree and session status, navigates, renames, and archives.
- Thread detail route: `apps/web/src/routes/_chat.$environmentId.$threadId.tsx:13-77`. Imported threads are ordinary T3 threads, so no route change is required after import.
- Chat integration hub: `apps/web/src/components/ChatView.tsx:2015-2198`, `apps/web/src/components/ChatView.tsx:4317-4371`, `apps/web/src/components/ChatView.tsx:5228-5296`, and `apps/web/src/components/ChatView.tsx:5378-5408`.
- Canonical timeline renderer: `apps/web/src/components/chat/MessagesTimeline.tsx:155-183` and `apps/web/src/components/chat/MessagesTimeline.tsx:189-528`.
- Composer/send path: `apps/web/src/components/chat/ChatComposer.tsx:400-550` and `apps/web/src/components/chat/ChatComposer.tsx:2027-2040`.

### Recommended UX

Add a distinct **Claude history** browser rather than injecting thousands of external sessions into the normal sidebar.

Suggested flow:

1. Sidebar project menu or global command: **Browse Claude sessions…**
2. Searchable/filterable panel:
   - title/first prompt
   - cwd/project
   - updated time
   - normal vs subagent
   - already imported
   - source host/index freshness
3. Read-only transcript detail with an explicit “External Claude session” banner.
4. Primary action: **Continue in T3**.
5. Confirmation sheet only when needed:
   - target project/cwd mismatch
   - provider instance selection
   - model/runtime mode
   - warning that old messages are read-only/not yet backfilled
6. After import, navigate to the normal thread route. Show a compact imported badge/provenance entry in the header and sidebar row.
7. If already imported, replace the action with **Open T3 thread**.

Add an explicit provenance object to the thread/detail projection rather than encoding provenance only in a `[imported]` title prefix. Suggested fields: provider, provider instance, native session ID, source path/host, source cwd, imported timestamp, source mtime/size, and backfill state.

Keep `ChatView`, `MessagesTimeline`, and `ChatComposer` on the existing canonical path. If historical backfill is implemented, normalize it into canonical messages/activities; do not make the timeline merge live T3 state with an independent JSONL parser in the browser.

## 5. Upstream GitHub issues and PRs

Research used `gh` against `pingdotgg/t3code`.

### Canonical import/external-session requests

- [#207 — request: import or recreate sessions from Codex](https://github.com/pingdotgg/t3code/issues/207) — open. Canonical upstream issue for discovering/importing provider sessions stored outside T3.
- [#3881 — Load all session in t3code within a project, even if it's opened via cli](https://github.com/pingdotgg/t3code/issues/3881) — open. Clearest current provider-neutral request to show CLI-created project sessions.
- [#330 — Load existing Codex threads available via `codex resume`](https://github.com/pingdotgg/t3code/issues/330) — closed as duplicate of #207. Proposes a recent-session/import dialog; discussion explicitly extends the request to Claude's `~/.claude/projects/*.jsonl` store.
- [#2206 — Import/sync existing Codex chats](https://github.com/pingdotgg/t3code/issues/2206) — closed as duplicate of #207. Requests local discovery plus refresh/sync.
- [#510 — remote parity with ssh + codex resume on the same host](https://github.com/pingdotgg/t3code/issues/510) — closed. Detailed discover/import/resume/rescan/no-duplicates workflow with imported/external labels.
- [#876 — Bi-directionally sync t3.code threads with provider threads](https://github.com/pingdotgg/t3code/issues/876) — closed, not planned. Broader continuous two-way sync request.
- [#2754 — import an OpenCode thread started outside T3](https://github.com/pingdotgg/t3code/issues/2754) — closed as duplicate of #207. Confirms the desired feature should be provider-shared.

### Claude continuity/resume issues

- [#2343 — T3Code forgets complete session history](https://github.com/pingdotgg/t3code/issues/2343) — open. UI history remains while resumed Claude context can be fresh.
- [#2336 — thread unusable if Claude session is killed before first turn](https://github.com/pingdotgg/t3code/issues/2336) — open. Documents invalid resume cursors pointing at nonexistent Claude JSONLs.
- [#2256 — session context lost after idle](https://github.com/pingdotgg/t3code/issues/2256) — closed by #2292. Investigation implicated session identity and cwd drift.
- [#2378 — should resume same conversation after idle timeout](https://github.com/pingdotgg/t3code/issues/2378) — closed as duplicate.
- [#2140 — loss of context after app restart](https://github.com/pingdotgg/t3code/issues/2140) — closed, cross-provider with Claude confirmations.
- [#2138 — Claude adapter loses prior-turn context on Linux](https://github.com/pingdotgg/t3code/issues/2138) — closed. Detailed underlying-session rotation evidence.
- [#2863 — Bidirectional communication with Claude Code session](https://github.com/pingdotgg/t3code/issues/2863) — closed. Explores bridging an already-running external Claude session and its JSONL stream.

### Relevant PRs

- [#2814 — sync resume sessions after CLI modifications](https://github.com/pingdotgg/t3code/pull/2814) — open. Reads externally appended turns for a Claude session T3 already knows; does not discover/import unknown sessions.
- [#3860 — Restore Claude session continuity for resume, wake, and idle release](https://github.com/pingdotgg/t3code/pull/3860) — merged. Current resume/recycle fix.
- [#3750 — Resume persisted Claude sessions after provider recycle](https://github.com/pingdotgg/t3code/pull/3750) — closed, superseded by #3860.
- [#2292 — Fix Claude session cwd resume drift](https://github.com/pingdotgg/t3code/pull/2292) — merged. Directly relevant to cwd/session coupling.
- [#914 — Open in Warp with Claude Code session resume](https://github.com/pingdotgg/t3code/pull/914) — closed/unmerged. Exposed native session ID and launched `claude --resume <id>` externally.
- [#3677 — session audit remediation](https://github.com/pingdotgg/t3code/pull/3677) — open. Broader diagnostics/recovery work; continuity changes moved to #3860.

Related browsing UX requests:

- [#3509 — Search all threads by message content](https://github.com/pingdotgg/t3code/issues/3509) — open.
- [#3523 — Claude Desktop-inspired thread filtering](https://github.com/pingdotgg/t3code/issues/3523) — open.

No upstream PR found implements end-to-end discovery, read-only browsing, import, and continuation of previously unknown Claude Code sessions.

## 6. CCS integration options

CCS is a separate local Claude-session browser/index at `/Users/mimen/Programming/Repos/claude-sessions`. The executable is `/Users/mimen/.bun/bin/ccs`, a symlink to `/Users/mimen/Programming/Repos/claude-sessions/bin/ccs`; the Bun launcher is `/Users/mimen/Programming/Repos/claude-sessions/bin/ccs:1-4`.

Current CCS runtime paths are defined in `/Users/mimen/Programming/Repos/claude-sessions/src/paths.ts:5-32`:

```text
~/.ccs/cache/index.db
~/.ccs/cache/catalogue.db
~/.ccs/cache/skills.db
~/.ccs/config.toml
```

`~/.claude-sessions/` is a legacy/retired root. Hard-coding `~/.claude-sessions/index.db` would target stale state on this machine.

### What the CCS index contains

The rebuildable index schema is `/Users/mimen/Programming/Repos/claude-sessions/src/index/schema.ts:1-79`.

Its `sessions` table includes source path, session/resume IDs, cwd/project/branch, timestamps/counts, title fields, parent/subagent relation, usage/cost, and loop metadata. `sessions_fts` indexes `session_id`, title, and a bounded content skeleton.

Important limitation: CCS does not index the complete transcript. Its skeleton keeps the first eight and last four rendered turns and caps text at 14,000 characters; tool calls/results are reduced to stubs. See `/Users/mimen/Programming/Repos/claude-sessions/src/parse.ts:36-40`, `/Users/mimen/Programming/Repos/claude-sessions/src/parse.ts:67-89`, and `/Users/mimen/Programming/Repos/claude-sessions/src/parse.ts:214-220`. Its rendered transcript reader is also bounded to 400 messages: `/Users/mimen/Programming/Repos/claude-sessions/src/transcript.ts:17-95`.

CCS recursively scans Claude JSONLs and streams them line-by-line: `/Users/mimen/Programming/Repos/claude-sessions/src/store.ts:15-39` and `/Users/mimen/Programming/Repos/claude-sessions/src/parse.ts:91-211`. Its README explicitly treats the Claude store as authoritative and the index as rebuildable: `/Users/mimen/Programming/Repos/claude-sessions/README.md:104-114`.

### Option A: call CCS

Use for explicit operator actions where CCS already adds value: resume/fork, cmux launch, identity/cluster/catalogue workflows, or optional metadata export.

Pros:

- Reuses mature resume-ID and cwd recovery logic.
- Reuses subagent grouping, titles, costs, and operator workflows.
- `ccs` already provides TUI browse/search/resume and CLI commands (`reindex`, `ls`, `tree`, `meta`, resume/cluster/catalogue commands); contract at `/Users/mimen/Programming/Repos/claude-sessions/src/cli.ts:43-131`.

Cons:

- No stable HTTP/SDK API and no documented general JSON search endpoint.
- Version `0.1.0`, rapidly evolving internal schema/commands.
- Hard Bun/PATH/config dependency.
- Some commands mutate CCS state or spawn/focus Claude/cmux.
- No declared repository/package license was found, so embedding/redistribution rights should not be assumed.

Verdict: optional action/enrichment adapter, not T3's core data layer.

### Option B: parse Claude JSONL directly

Pros:

- Canonical, complete source with exact messages/tool records.
- Independent of CCS installation, index freshness, schema churn, and runtime-path migrations.
- Allows T3-specific security, normalization, search, and incremental indexing.

Cons:

- T3 owns schema-drift tolerance, streaming, duplicate/resume resolution, subagent lineage, search, and large-file behavior.

Verdict: recommended authoritative ingestion layer.

### Option C: read/share the CCS index

Pros:

- Fast FTS and useful normalized metadata.
- Good optional prefilter for session candidates.

Cons:

- Rebuildable cache, not a compatibility contract.
- Schema can be dropped/recreated on version changes: `/Users/mimen/Programming/Repos/claude-sessions/src/index/schema.ts:3-30`.
- Bounded/lossy content.
- Must locate current `~/.ccs/cache/index.db`, open read-only/WAL-aware, and never write or attempt to maintain its FTS rows.

Verdict: acceptable as best-effort read-only acceleration/enrichment only.

### Recommended hybrid

- Primary: T3 streams/parses `~/.claude/projects/**/*.jsonl` and owns its browser catalog.
- Optional enrichment: if CCS is installed, read its current index through a version-checked adapter for title/cost/resume-ID hints, then validate source path/mtime/size against JSONL.
- Explicit actions: invoke `ccs` only for user-requested CCS-specific resume/fork/cluster/cmux workflows.

## 7. Spike implementation, evidence, and reproduction

### Implemented command

`apps/server/src/bin.ts:12-15` and `apps/server/src/bin.ts:42-54` register a new top-level `session` command. `apps/server/src/cli/sessionImport.ts:140-247` implements:

```text
t3 session import <session-id-or-jsonl-path> [--model <model>] [project/base-dir flags]
```

It:

- accepts a transcript path or scans `~/.claude/projects/*/<session-id>.jsonl`;
- extracts session ID, cwd, first user-text title, and user-turn count;
- creates/reuses a project by exact workspace root;
- creates a normal thread;
- seeds a matching Claude provider runtime row with the external resume ID.

### Empirical evidence

Artifacts:

- Initial snapshot: `/private/tmp/t3snap.json`
- Post-turn thread detail: `/private/tmp/thread.json`
- Provider event log: `/private/tmp/t3-spike-home/userdata/logs/provider/7260d0c5-4e99-4707-8378-f8fba657adb8.log`
- Trace log: `/private/tmp/t3-spike-home/userdata/logs/server.trace.ndjson`
- SQLite DB: `/private/tmp/t3-spike-home/userdata/state.sqlite`

Observed:

1. `/private/tmp/t3snap.json` contained T3 thread `7260d0c5-4e99-4707-8378-f8fba657adb8`, title `[imported] skills`, model selection `claudeAgent / claude-opus-4-8`, and an initially empty message list.
2. Trace span line 1902 in `server.trace.ndjson` recorded:

   ```text
   claude.resume.source = resume-session
   claude.resume.session_id = 0af38204-088d-40d7-a2ea-c3ba44441ce0
   claude.query.resume = 0af38204-088d-40d7-a2ea-c3ba44441ce0
   claude.query.cwd = /Users/mimen/Programming/Repos
   ```

3. Provider log line 1 recorded `session.started` with the imported resume cursor.
4. Provider log line 5 recorded `thread.started` with `providerThreadId` equal to the external Claude session ID.
5. Provider log line 6 recorded Claude `system:init` with the same `session_id` and cwd.
6. The submitted live turn reached Claude. Provider log lines 10-17 recorded a real rate-limit event, assistant result, and completed T3 turn. The returned text was:

   ```text
   You've hit your session limit · resets 12am (America/Los_Angeles)
   ```

7. `/private/tmp/thread.json` showed the accepted user message, provider-generated limit response, ready session, and token/context activity. The model-capacity limit prevented the requested semantic proof phrase, but it does not weaken the transport/resume proof: the external UUID was used by the SDK, acknowledged by Claude init/status events, and produced a provider response to the new turn.

### Exact reproduction commands

The spike was run from the server package with Node. The following is a cleaned reproduction of the actual commands, without embedding the short-lived bearer token.

1. Stop the T3 server that owns the target DB. Import is currently offline-only.

2. Import the external Claude session:

```bash
cd /Users/mimen/Programming/Repos/t3code-spike-sessions/apps/server
node src/bin.ts session import \
  0af38204-088d-40d7-a2ea-c3ba44441ce0 \
  --base-dir /tmp/t3-spike-home
```

3. Start the server for the imported cwd:

```bash
export PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v cmux | paste -sd: -)
cd /Users/mimen/Programming/Repos/t3code-spike-sessions/apps/server
node src/bin.ts serve \
  --port 3778 \
  --base-dir /tmp/t3-spike-home \
  /Users/mimen/Programming/Repos \
  > /tmp/t3spike-serve.log 2>&1
```

4. Issue an API token and snapshot the imported thread:

```bash
cd /Users/mimen/Programming/Repos/t3code-spike-sessions/apps/server
node src/bin.ts auth session issue \
  --base-dir /tmp/t3-spike-home \
  --token-only 2>&1 \
  | grep -E '^eyJ' \
  | tail -1 \
  > /tmp/t3spike-token

T=$(cat /tmp/t3spike-token)
curl -s \
  -H "Authorization: Bearer $T" \
  http://127.0.0.1:3778/api/orchestration/snapshot \
  > /private/tmp/t3snap.json
```

5. Dispatch a live turn:

```bash
T=$(cat /tmp/t3spike-token)
CMD=$(python3 - <<'PY'
import datetime
import json
import uuid

now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
print(json.dumps({
    'type': 'thread.turn.start',
    'commandId': str(uuid.uuid4()),
    'threadId': '7260d0c5-4e99-4707-8378-f8fba657adb8',
    'message': {
        'messageId': str(uuid.uuid4()),
        'role': 'user',
        'text': 'Without using tools, reply exactly RESUMED-IN-T3CODE, then summarize in one sentence what this prior session discussed.',
        'attachments': [],
    },
    'createdAt': now,
}))
PY
)

curl -s -X POST \
  -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' \
  -d "$CMD" \
  http://127.0.0.1:3778/api/orchestration/dispatch
```

6. Inspect evidence:

```bash
rg -n -o '.{0,220}(claude\.resume\.source|claude\.query\.resume).{0,260}' \
  /tmp/t3-spike-home/userdata/logs/server.trace.ndjson

rg -n 'session.started|thread.started|claude/system/init|rate_limit_event|session limit' \
  /tmp/t3-spike-home/userdata/logs/provider/7260d0c5-4e99-4707-8378-f8fba657adb8.log

sqlite3 -header -column /tmp/t3-spike-home/userdata/state.sqlite \
  "SELECT * FROM provider_session_runtime WHERE thread_id='7260d0c5-4e99-4707-8378-f8fba657adb8';"
```

### Current limitations

- Historical Claude messages are not backfilled into `projection_thread_messages`; the imported thread initially appears empty.
- Import mutates the same event/projection/runtime DB as the server, so the server must currently be stopped. The help text documents this but there is no lock/enforcement yet.
- The spike hardcodes provider `instanceId`/adapter to `claudeAgent` and does not offer configured Claude-instance selection.
- No provenance schema or idempotency key prevents duplicate imports.
- Session-ID lookup currently scans only one directory level under `~/.claude/projects`; nested subagent transcripts require a direct path or recursive discovery in a production browser.
- The parser counts every `type:"user"` record, including tool-result records, as a user turn. Production parsing must distinguish `origin.kind:"human"`/typed prompts from tool results.
- Explicit paths can point outside `~/.claude/projects`; malformed JSON lines are skipped; cwd existence/storage-folder mapping is not yet validated.
- Offline project/thread/runtime writes are not atomic as one high-level import transaction, and a partial failure can leave an incomplete import.
- The empirical live turn was capacity-limited, so it proves resumed-path transport and provider acceptance, not semantic recall of the old transcript.

## Validation status

- `bun run --cwd apps/server typecheck`: passed after spike-local fixes.
- `bun run --cwd apps/server test -- src/bin.test.ts`: passed, 1 file / 15 tests.
- Fresh temporary-base CLI smoke test: passed; migrations ran, a project/thread were created, and the external resume cursor was seeded.
- `git diff --check`: passed.
