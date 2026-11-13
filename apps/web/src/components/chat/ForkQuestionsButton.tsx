import { MessageCircleQuestionIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Fork: the prompt the composer's question button sends, a Claude Code skill. */
export const FORK_QUESTIONS_PROMPT = "/q";

const LABEL = `Work through my questions (${FORK_QUESTIONS_PROMPT})`;

export function ForkQuestionsButton(props: {
  readonly disabled: boolean;
  readonly onSend: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={props.disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={props.onSend}
            aria-label={LABEL}
          />
        }
      >
        <MessageCircleQuestionIcon />
      </TooltipTrigger>
      <TooltipPopup>{props.disabled ? `${LABEL}. Clear the draft first.` : LABEL}</TooltipPopup>
    </Tooltip>
  );
}
