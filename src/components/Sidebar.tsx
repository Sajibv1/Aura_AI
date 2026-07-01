"use client";

import { useState } from "react";
import { MessageSquare, Plus, Trash2, ChevronLeft, ChevronRight, Edit3, Check, X } from "lucide-react";
import type { Conversation } from "@/hooks/useConversations";

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

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onRename, collapsed, onToggle }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        {!collapsed && <span className="sidebar-title">Chats</span>}
        <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <button className="new-chat-btn" onClick={onNew} title="New Chat">
        <Plus size={18} />
        {!collapsed && <span>New Chat</span>}
      </button>

      <nav className="conversation-list">
        {conversations.map((conv) => {
          const isActive = conv.id === activeId;
          return (
            <div
              key={conv.id}
              className={`conv-item ${isActive ? "active" : ""}`}
              onClick={() => onSelect(conv.id)}
            >
              <MessageSquare size={16} className="conv-icon" />
              {!collapsed && (
                <div className="conv-content">
                  {editingId === conv.id ? (
                    <form
                      className="rename-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRename(conv.id, editValue.trim() || conv.title);
                        setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="rename-input"
                        onBlur={() => setEditingId(null)}
                        onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                      />
                      <button type="submit" className="icon-btn-sm"><Check size={12} /></button>
                      <button type="button" className="icon-btn-sm" onClick={() => setEditingId(null)}><X size={12} /></button>
                    </form>
                  ) : (
                    <span className="conv-title">{conv.title}</span>
                  )}
                </div>
              )}
              {!collapsed && isActive && editingId !== conv.id && (
                <div className="conv-actions">
                  <button
                    className="icon-btn-sm"
                    onClick={(e) => { e.stopPropagation(); setEditingId(conv.id); setEditValue(conv.title); }}
                    title="Rename"
                  >
                    <Edit3 size={12} />
                  </button>
                  <button
                    className="icon-btn-sm"
                    onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
