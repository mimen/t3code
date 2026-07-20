# Spike: claude-gpt (GPT models via Claude Code harness) inside t3code

**Verdict: works today with ZERO code changes.** Upstream ships every seam needed; integration is pure configuration.

## Chain (all verified in code + empirically)

- Driver `claudeAgent` (apps/server/src/provider/Drivers/ClaudeDriver.ts) -> @anthropic-ai/claude-agent-sdk query() in apps/server/src/provider/Layers/ClaudeAdapter.ts (~3443): pathToClaudeCodeExecutable=binaryPath, model=apiModelId, env=claudeEnvironment, extraArgs=launchArgs. SDK spawns the claude CLI subprocess.
- Per-instance env vars first-class: ProviderInstanceConfig.environment (packages/contracts/src/providerInstance.ts:104-131) -> ProviderInstanceRegistryLive.ts:173 -> ClaudeDriver.ts:126 mergeProviderInstanceEnvironment -> SDK spawn env. UI: ProviderInstanceCard.tsx.
- Custom models first-class: ClaudeSettings.customModels (settings.ts:227) merged at ClaudeProvider.ts:669; UI ProviderModelsSection.tsx; normalizeModelSlug only trims so "gpt-5.6-sol[1m]" passes verbatim to --model (put [1m] IN the slug).
- Multi-instance: ClaudeDriver supportsMultipleInstances:true.

## Spike results (this branch)

1. spike/sdk-probe.ts (copy at apps/server/spike-probe.ts): SDK driven exactly like ClaudeAdapter, gateway env + gpt-5.6-luna[1m] -> SUCCESS, usage reported gpt-5.6-luna[1m], ctx 1,000,000.
   Repro: cd apps/server && node spike-probe.ts "gpt-5.6-luna[1m]" (gateway: brew services start cliproxyapi)
2. spike/claude-gpt-stdio: wrapper-binary fallback (env + exec claude "$@"); SDK spawns shebang scripts fine. Not needed given first-class env vars.
3. Seeded providerInstances settings.json (instance claude-gpt, gateway env, 4 custom models) into isolated --base-dir; server started clean, no settings-parse warnings.

## Recommended setup (no fork changes)

Settings -> Providers -> Claude -> Add instance:

- Display name: Claude-GPT
- Env vars: ANTHROPIC_BASE_URL=http://127.0.0.1:8317, ANTHROPIC_AUTH_TOKEN=<~/.cli-proxy-api-key> (sensitive), CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK=1, CLAUDE_CODE_AUTO_COMPACT_WINDOW=372000
- Custom models: gpt-5.6-sol[1m], gpt-5.6-terra[1m], gpt-5.6-luna[1m], gpt-5.5[1m]
- homePath empty (t3code passes --model per session; slot-pollution gotcha does not apply). binaryPath stays "claude".

## Caveats

- Custom models get DEFAULT capabilities: no effort picker in UI; pin effort via slug suffix e.g. gpt-5.6-terra(xhigh)[1m].
- Account-info probe against gateway may show odd identity - cosmetic.
- Gateway does not forward reasoning blocks (thinking invisible), same as terminal claude-gpt.
- Keep the stock Claude instance untouched (vault rule: Claude sub never rides the proxy).
