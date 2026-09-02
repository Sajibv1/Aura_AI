"use client";

import { useState } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import type { Conversation } from "@/hooks/useConversations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  collapsed,
  onToggle,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-14" : "w-64",
      )}
    >
      <div className="flex h-12 items-center justify-between border-b px-2">
        {!collapsed && (
          <span className="px-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Chats
          </span>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggle}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              />
            }
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </TooltipTrigger>
          <TooltipContent>{collapsed ? "Expand" : "Collapse"}</TooltipContent>
        </Tooltip>
      </div>

      <div className="p-2">
        <Button
          variant="default"
          size={collapsed ? "icon" : "default"}
          className={cn("w-full", !collapsed && "justify-start")}
          onClick={onNew}
        >
          <PlusIcon data-icon={collapsed ? undefined : "inline-start"} />
          {!collapsed && <span>New Chat</span>}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-0.5 p-2">
          {conversations.map((conv) => {
            const isActive = conv.id === activeId;
            const isEditing = editingId === conv.id;

            return (
              <div
                key={conv.id}
                className={cn(
                  "group/conv flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => onSelect(conv.id)}
                >
                  <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                  {!collapsed &&
                    (isEditing ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                        onSubmit={(e) => {
                          e.preventDefault();
                          onRename(conv.id, editValue.trim() || conv.title);
                          setEditingId(null);
                        }}
                      >
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-6 px-1.5 text-xs"
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <Button type="submit" variant="ghost" size="icon-xs">
                          <CheckIcon />
                          <span className="sr-only">Save</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setEditingId(null)}
                        >
                          <XIcon />
                          <span className="sr-only">Cancel</span>
                        </Button>
                      </form>
                    ) : (
                      <span className="truncate">{conv.title}</span>
                    ))}
                </button>
                {!collapsed && isActive && !isEditing && (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/conv:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(conv.id);
                        setEditValue(conv.title);
                      }}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(conv.id);
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
