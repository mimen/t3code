import type { ClaudeSessionPreview } from "@t3tools/contracts";
import { LoaderIcon, TriangleAlertIcon } from "lucide-react";

interface ClaudeSessionPreviewPanelProps {
  readonly preview: ClaudeSessionPreview | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

function PreviewExcerpt(props: { readonly label: string; readonly text: string | null }) {
  return (
    <div className="grid gap-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {props.label}
      </div>
      <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">
        {props.text ?? "No visible excerpt available."}
      </div>
    </div>
  );
}

export function ClaudeSessionPreviewPanel({
  preview,
  isLoading,
  error,
}: ClaudeSessionPreviewPanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-4 text-xs text-muted-foreground">
        <LoaderIcon className="size-3.5 animate-spin" />
        Loading a short live preview from the source environment…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-3 text-xs text-warning-foreground">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!preview) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/25 px-3 py-3">
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>Live short preview · {preview.localSourceHost}</span>
        {preview.isPartial ? <span>Bounded excerpt</span> : null}
      </div>
      <PreviewExcerpt label="First prompt" text={preview.firstUserExcerpt} />
      <PreviewExcerpt label="Latest user" text={preview.latestUserExcerpt} />
      <PreviewExcerpt label="Latest assistant" text={preview.latestAssistantExcerpt} />
      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        Preview text is fetched on demand from the owning environment. Tool output and reasoning are
        not included.
      </p>
    </div>
  );
}
