import { Clock3Icon, EyeIcon, LoaderIcon, MessageSquareTextIcon } from "lucide-react";

import {
  federatedClaudeSessionKey,
  presentClaudeSessionAttachment,
  type FederatedClaudeSession,
} from "../../claudeSessionSurfaces.logic";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

interface ClaudeSessionRowProps {
  readonly session: FederatedClaudeSession;
  readonly showEnvironment: boolean;
  readonly isOpening: boolean;
  readonly previewSessionKey: string | null;
  readonly onOpen: (session: FederatedClaudeSession) => void;
  readonly onPreview: (session: FederatedClaudeSession) => void;
  readonly onSelect?: (session: FederatedClaudeSession) => void;
  readonly selected?: boolean;
  readonly compact?: boolean;
}

const BADGE_VARIANT_BY_TONE = {
  neutral: "outline",
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
} as const;

export function ClaudeSessionRow({
  session,
  showEnvironment,
  isOpening,
  previewSessionKey,
  onOpen,
  onPreview,
  onSelect,
  selected = false,
  compact = false,
}: ClaudeSessionRowProps) {
  const attachment = presentClaudeSessionAttachment(session.session);
  const sessionKey = federatedClaudeSessionKey(session);
  const isPreviewed = previewSessionKey === sessionKey;
  const activityLabel = session.session.latestActivityAt
    ? formatRelativeTimeLabel(session.session.latestActivityAt)
    : "No activity time";

  return (
    <div
      className={`rounded-lg border bg-card transition-colors ${
        selected ? "border-primary/50 bg-primary/4 ring-1 ring-primary/20" : "border-border/80"
      }`}
    >
      <div
        className={`flex min-w-0 gap-3 ${compact ? "px-3 py-2" : "px-3 py-3"} ${
          onSelect ? "cursor-pointer" : ""
        }`}
        onClick={
          onSelect
            ? () => {
                onSelect(session);
              }
            : undefined
        }
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium">{session.session.title}</span>
            <Badge
              size="sm"
              variant={BADGE_VARIANT_BY_TONE[attachment.tone]}
              title={attachment.detail ?? attachment.label}
            >
              {attachment.label}
            </Badge>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {showEnvironment ? (
              <span className="font-medium">{session.environmentLabel}</span>
            ) : null}
            <span>{session.session.projectName}</span>
            {session.session.branch ? <span>#{session.session.branch}</span> : null}
            <span className="inline-flex items-center gap-1">
              <Clock3Icon className="size-3" />
              {activityLabel}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquareTextIcon className="size-3" />
              {session.session.messageCount.toLocaleString()}
            </span>
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground/75">
            {session.session.sourceCwd}
          </div>
          {!compact ? (
            <div className="truncate font-mono text-[9px] text-muted-foreground/55">
              {session.session.nativeSessionId}
            </div>
          ) : null}
          {attachment.detail ? (
            <div className="line-clamp-2 text-[10px] text-warning-foreground">
              {attachment.detail}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          <Button
            type="button"
            aria-label={`Preview ${session.session.title}`}
            variant={isPreviewed ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              onPreview(session);
            }}
          >
            <EyeIcon className="size-3.5" />
            <span className="max-sm:hidden">Preview</span>
          </Button>
          {!onSelect ? (
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={isOpening}
              onClick={(event) => {
                event.stopPropagation();
                onOpen(session);
              }}
            >
              {isOpening ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                attachment.actionLabel
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
