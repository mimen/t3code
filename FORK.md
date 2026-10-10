---
upstream: pingdotgg/t3code
sync_tags: v*-nightly.*
check: scripts/fork/check.sh
release: scripts/fork/release.sh
---

# Fork of pingdotgg/t3code

Milad's maintained fork. Upstream changes merge in by tag (`sync_tags`), one tag at a time, following the `fork` skill's sync playbook. Fork code lives in fork-owned paths wherever it can, and the table below lists every upstream file the fork still edits.

## Fork features

| Feature | Fork-owned code | Smoke test |
|---|---|---|
| Claude Code session import | `apps/server/src/claudeSessions/`, `apps/server/src/cli/sessionImport.ts`, web and mobile `claude-sessions` surfaces | see `scripts/fork/check.sh` |
| Fork migrations | `apps/server/src/fork/migrations/`, own tracking table `fork_sql_migrations` | see `scripts/fork/check.sh` |
| Custom model controls | `apps/server/src/provider/Layers/ClaudeModelCatalog.ts`, `ProviderInstanceIconPicker.tsx` | see `scripts/fork/check.sh` |
| Desktop remote-only mode | `apps/desktop/src/ipc/methods/executionMode.ts`, `apps/web/src/desktopRuntimeCapabilities.ts` | see `scripts/fork/check.sh` |
| Filtered Sidebar V2 default | settings default in `packages/contracts/src/settings.ts` | see `scripts/fork/check.sh` |
| Desktop identity | `scripts/fork/` and the desktop identity module | see `scripts/fork/check.sh` |

## Upstream paths the fork edits

| Path | Why |
|---|---|
| `AGENTS.md` | fork block at the top: points to FORK.md and the fork skill |
| `apps/desktop/scripts/dev-electron.mjs` | dev launch guard: refuses a dev desktop run unless T3CODE_ALLOW_DEV_DESKTOP=1 |
| `apps/desktop/src/backend/DesktopServerExposure.test.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/desktop/src/ipc/DesktopIpcHandlers.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/desktop/src/ipc/channels.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/desktop/src/preload.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/desktop/src/settings/DesktopAppSettings.test.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/desktop/src/settings/DesktopAppSettings.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/desktop/src/updates/DesktopUpdates.test.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/desktop/src/window/DesktopWindow.test.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/mobile/app.config.ts` | mobile: personal Apple team override for local iOS builds |
| `apps/mobile/src/Stack.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/mobile/src/components/ProviderIcon.tsx` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/mobile/src/features/settings/SettingsRouteScreen.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/mobile/src/features/settings/components/settings-sheet-targets.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/mobile/src/features/threads/ThreadComposer.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/mobile/src/features/threads/ThreadFeed.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/mobile/src/features/threads/ThreadRouteScreen.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/mobile/src/features/threads/new-task-flow-provider.tsx` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/mobile/src/lib/modelOptions.test.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/mobile/src/lib/modelOptions.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/mobile/src/state/use-thread-composer-state.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/mobile/src/state/use-thread-outbox-drain.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/mobile/src/state/use-thread-selection.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/bin.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/checkpointing/CheckpointDiffQuery.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/Schemas.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/decider.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/http.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/projector.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/orchestration/projector.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/persistence/Layers/ProjectionThreadActivities.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/persistence/Layers/ProjectionThreadMessages.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/persistence/Services/ProjectionThreadActivities.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/persistence/Services/ProjectionThreadMessages.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/project/ProjectSetupScriptRunner.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/provider/Drivers/ClaudeDriver.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/Layers/ClaudeAdapter.test.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/Layers/ClaudeProvider.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.test.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/Layers/ProviderRegistry.test.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/Layers/ProviderRegistry.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/Layers/ProviderService.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/provider/Layers/ProviderSessionReaper.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/provider/providerSnapshot.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/providerStatusCache.test.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/providerStatusCache.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/provider/unavailableProviderSnapshot.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/server.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/serverRuntimeStartup.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/serverSettings.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/server/src/textGeneration/ClaudeTextGeneration.test.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/textGeneration/ClaudeTextGeneration.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/server/src/ws.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/components/BranchToolbar.logic.test.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/BranchToolbar.logic.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/BranchToolbar.tsx` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/BranchToolbarEnvironmentSelector.tsx` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/ChatView.logic.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/components/ChatView.logic.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/components/ChatView.tsx` | session import surfaces, and desktop remote-only mode |
| `apps/web/src/components/CommandPalette.logic.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/components/CommandPalette.logic.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/components/CommandPalette.tsx` | session import surfaces, and desktop remote-only mode |
| `apps/web/src/components/CommandPaletteResults.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/components/Sidebar.logic.test.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/Sidebar.logic.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/Sidebar.tsx` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/SidebarV2.tsx` | filtered Sidebar V2 default, plus session-import sidebar entries |
| `apps/web/src/components/chat/ChatComposer.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/components/chat/DraftHeroHeadline.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/components/chat/MessagesTimeline.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/components/chat/ModelListRow.tsx` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/web/src/components/chat/ModelPickerContent.tsx` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/web/src/components/chat/ModelPickerSidebar.tsx` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/chat/ProviderInstanceIcon.tsx` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/web/src/components/chat/ProviderModelPicker.tsx` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/web/src/components/chat/providerIconUtils.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/web/src/components/settings/AddProviderInstanceDialog.tsx` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/web/src/components/settings/ConnectionsSettings.tsx` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/settings/DiagnosticsSettings.tsx` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/components/settings/ProviderInstanceCard.tsx` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/web/src/components/settings/SettingsPanels.tsx` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `apps/web/src/providerInstances.test.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/web/src/providerInstances.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `apps/web/src/routes/_chat.tsx` | session import: Claude Code sessions imported and continued as T3 threads |
| `apps/web/src/session-logic.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/client-runtime/package.json` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/client-runtime/src/operations/commands.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/client-runtime/src/operations/commands.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/client-runtime/src/state/entities.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/client-runtime/src/state/shell-sync.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/client-runtime/src/state/shell.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/client-runtime/src/state/threadCommands.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/client-runtime/src/state/threadDetail.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/client-runtime/src/state/threadReducer.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/contracts/src/environmentHttp.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/contracts/src/ipc.ts` | desktop remote-only mode: run the desktop shell without its bundled local server |
| `packages/contracts/src/orchestration.test.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/contracts/src/orchestration.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/contracts/src/providerInstance.test.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `packages/contracts/src/providerInstance.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `packages/contracts/src/rpc.ts` | session import: Claude Code sessions imported and continued as T3 threads |
| `packages/contracts/src/server.test.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `packages/contracts/src/server.ts` | model controls: custom Claude model catalog, per-instance icons, and model picker metadata |
| `packages/contracts/src/settings.test.ts` | filtered Sidebar V2 default and custom model profile settings |
| `packages/contracts/src/settings.ts` | filtered Sidebar V2 default and custom model profile settings |
| `apps/server/src/persistence/Layers/Sqlite.ts` | fork migrations: hook runs the fork Migrator (`fork_sql_migrations`) after upstream's |
