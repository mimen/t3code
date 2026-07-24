import {
  CLAUDE_SESSION_CATALOGUE_PROTOCOL_VERSION,
  type ClaudeSessionAttachmentStatus,
  type ClaudeSessionAttachmentStatusSnapshot,
  type ClaudeSessionCataloguePage,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ExternalClaudeSessionRepositoryError } from "../persistence/Services/ExternalClaudeSessions.ts";
import { ExternalClaudeSessionRepository } from "../persistence/Services/ExternalClaudeSessions.ts";

function attachmentIdentity(input: {
  readonly providerInstanceId: string;
  readonly localSourceHost: string;
  readonly nativeSessionId: string;
}): string {
  return `${input.providerInstanceId}\u0000${input.localSourceHost}\u0000${input.nativeSessionId}`;
}

export function joinClaudeSessionAttachments(
  page: ClaudeSessionCataloguePage,
  attachments: ReadonlyArray<ClaudeSessionAttachmentStatus>,
): ClaudeSessionCataloguePage {
  const byIdentity = new Map(
    attachments.map((attachment) => [attachmentIdentity(attachment), attachment]),
  );
  return {
    ...page,
    sessions: page.sessions.map((session) => {
      const attachment = byIdentity.get(attachmentIdentity(session));
      if (attachment === undefined) {
        return session;
      }
      return {
        ...session,
        attachment: {
          sourceId: attachment.sourceId,
          threadId: attachment.threadId,
          projectId: attachment.projectId,
          state: attachment.state,
          lastSyncedAt: attachment.lastSyncedAt,
          diagnostic: attachment.diagnostic,
          runtimeStatus: attachment.runtimeStatus,
          runtimeLastSeenAt: attachment.runtimeLastSeenAt,
        },
      };
    }),
  };
}

export interface ClaudeSessionStatusShape {
  readonly getSnapshot: () => Effect.Effect<
    ClaudeSessionAttachmentStatusSnapshot,
    ExternalClaudeSessionRepositoryError
  >;
  readonly joinCataloguePage: (
    page: ClaudeSessionCataloguePage,
  ) => Effect.Effect<ClaudeSessionCataloguePage, ExternalClaudeSessionRepositoryError>;
}

export class ClaudeSessionStatus extends Context.Service<
  ClaudeSessionStatus,
  ClaudeSessionStatusShape
>()("t3/claudeSessions/ClaudeSessionStatus") {}

const makeClaudeSessionStatus = Effect.gen(function* () {
  const externalSessions = yield* ExternalClaudeSessionRepository;

  const getSnapshot: ClaudeSessionStatusShape["getSnapshot"] = Effect.fn(
    "ClaudeSessionStatus.getSnapshot",
  )(function* () {
    const attachments = yield* externalSessions.listActiveAttachmentStatuses();
    return {
      protocolVersion: CLAUDE_SESSION_CATALOGUE_PROTOCOL_VERSION,
      generatedAt: DateTime.formatIso(yield* DateTime.now),
      attachments,
    };
  });

  const joinCataloguePage: ClaudeSessionStatusShape["joinCataloguePage"] = Effect.fn(
    "ClaudeSessionStatus.joinCataloguePage",
  )(function* (page) {
    const attachments = yield* externalSessions.listActiveAttachmentStatuses();
    return joinClaudeSessionAttachments(page, attachments);
  });

  return { getSnapshot, joinCataloguePage } satisfies ClaudeSessionStatusShape;
});

export const ClaudeSessionStatusLive = Layer.effect(ClaudeSessionStatus, makeClaudeSessionStatus);
