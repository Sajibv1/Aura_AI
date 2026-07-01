"use client";

import { Download } from "lucide-react";
import type { Conversation } from "@/hooks/useConversations";
import { conversationToMarkdown, downloadMarkdown } from "@/utils/export";

type Props = {
  conversation: Conversation | null;
};

export function ExportButton({ conversation }: Props) {
  if (!conversation || conversation.messages.length === 0) return null;

  return (
    <button
      className="icon-btn"
      onClick={() => {
        const md = conversationToMarkdown(conversation);
        downloadMarkdown(md, `aura-${conversation.title.substring(0, 40)}`);
      }}
      title="Export as Markdown"
    >
      <Download size={18} />
    </button>
  );
}
