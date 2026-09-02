"use client";

import { DownloadIcon } from "lucide-react";

import type { Conversation } from "@/hooks/useConversations";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { conversationToMarkdown, downloadMarkdown } from "@/utils/export";

type Props = {
  conversation: Conversation | null;
};

export function ExportButton({ conversation }: Props) {
  if (!conversation || conversation.messages.length === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Export as Markdown"
            onClick={() => {
              const md = conversationToMarkdown(conversation);
              downloadMarkdown(md, `aura-${conversation.title.substring(0, 40)}`);
            }}
          />
        }
      >
        <DownloadIcon />
      </TooltipTrigger>
      <TooltipContent>Export as Markdown</TooltipContent>
    </Tooltip>
  );
}
