import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { readBootstrapEnvelope } from "../bootstrap.ts";
import * as ServerConfig from "../config.ts";
import {
  configureClaudeGptProvider,
  type ConfigureClaudeGptProviderInput,
  isForbiddenClaudeGptWrapperPath,
} from "../miniOps/claudeGptProvider.ts";
import * as ServerSettings from "../serverSettings.ts";
import { baseDirFlag, resolveCliAuthConfig } from "./config.ts";

const absolutePath = Schema.String.check(Schema.isPattern(/^\/.+$/));
const sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));

// A secret manager may need a few seconds to unlock or fetch the key. Keep the
// fd wait bounded so an absent writer cannot block the Mini operation forever.
export const GATEWAY_KEY_FD_TIMEOUT_MS = 30_000;

const gatewayKeyEnvelope = Schema.Struct({
  gatewayKey: TrimmedNonEmptyString,
});

class MissingGatewayKeyError extends CliError.UserError {
  override get message(): string {
    return "No gateway key was received from the configured file descriptor.";
  }
}

class ForbiddenClaudeGptWrapperPathError extends CliError.UserError {
  override get message(): string {
    return "--claude-cli-path must name the Claude Code CLI, not the claude-gpt wrapper.";
  }
}

const runConfigureClaudeGpt = (input: {
  readonly baseDir: Option.Option<string>;
  readonly claudeCliPath: string;
  readonly claudeCliSha256: string;
  readonly claudeHomePath: string;
  readonly gatewayKeyFd: number;
}) =>
  Effect.gen(function* () {
    if (isForbiddenClaudeGptWrapperPath(input.claudeCliPath)) {
      return yield* new ForbiddenClaudeGptWrapperPathError({ cause: undefined });
    }

    const gatewayKeyEnvelopeFromFd = yield* readBootstrapEnvelope(
      gatewayKeyEnvelope,
      input.gatewayKeyFd,
      { timeoutMs: GATEWAY_KEY_FD_TIMEOUT_MS },
    );
    const gatewayKey = Option.getOrUndefined(gatewayKeyEnvelopeFromFd)?.gatewayKey;
    if (gatewayKey === undefined) {
      return yield* new MissingGatewayKeyError({ cause: undefined });
    }

    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig({ baseDir: input.baseDir }, logLevel);
    const configureInput: ConfigureClaudeGptProviderInput = {
      gatewayKey,
      claudeCliPath: input.claudeCliPath,
      claudeCliSha256: input.claudeCliSha256,
      claudeHomePath: input.claudeHomePath,
    };

    yield* configureClaudeGptProvider(configureInput).pipe(
      Effect.provide(
        ServerSettings.layer.pipe(
          Layer.provide(ServerSecretStore.layer),
          Layer.provide(ServerConfig.layer(config)),
          Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
        ),
      ),
    );
    yield* Console.log("Configured the claude-gpt provider instance.");
  });

const configureClaudeGptCommand = Command.make("configure-claude-gpt", {
  baseDir: baseDirFlag,
  claudeCliPath: Flag.string("claude-cli-path").pipe(
    Flag.withSchema(absolutePath),
    Flag.withDescription("Absolute path to the claude-gpt CLI executable."),
  ),
  claudeCliSha256: Flag.string("claude-cli-sha256").pipe(
    Flag.withSchema(sha256),
    Flag.withDescription("Pinned SHA-256 of the canonical Claude Code CLI executable."),
  ),
  claudeHomePath: Flag.string("claude-home-path").pipe(
    Flag.withSchema(absolutePath),
    Flag.withDescription("Absolute, dedicated CLAUDE_CONFIG_DIR path for claude-gpt."),
  ),
  gatewayKeyFd: Flag.integer("gateway-key-fd").pipe(
    Flag.withSchema(Schema.Int),
    Flag.withDescription("File descriptor containing one JSON gateway-key envelope."),
  ),
}).pipe(
  Command.withDescription(
    "Register or update the Mini-local claude-gpt provider without writing gateway secrets to settings.json.",
  ),
  Command.withHandler(runConfigureClaudeGpt),
);

export const miniCommand = Command.make("mini").pipe(
  Command.withDescription("Mini-local operational commands."),
  Command.withSubcommands([configureClaudeGptCommand]),
);
