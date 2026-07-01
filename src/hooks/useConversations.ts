"use client";

import { useState, useEffect, useCallback } from "react";
import { loadJson, saveJson } from "@/utils/storage";

export type Message = {
  role: "user" | "assistant";
  content: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = "aura-conversations";

let nextId = 1;
function generateId(): string {
  return `conv_${Date.now()}_${nextId++}`;
}

function createConv(title?: string): Conversation {
  const now = Date.now();
  return {
    id: generateId(),
    title: title || "New Chat",
    messages: [],
    model: "llama-3.3-70b-versatile",
    createdAt: now,
    updatedAt: now,
  };
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = loadJson<Conversation[]>(STORAGE_KEY, []);
    setConversations(saved);
    if (saved.length > 0) {
      setActiveId(saved[0].id);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      saveJson(STORAGE_KEY, conversations);
    }
  }, [conversations, loaded]);

  const activeConversation = conversations.find((c) => c.id === activeId) || null;

  const switchConversation = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const newConversation = useCallback((title?: string) => {
    const conv = createConv(title);
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    return conv.id;
  }, []);

  const updateConversation = useCallback((id: string, updates: Partial<Conversation>) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c)),
    );
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (activeId === id) {
        setActiveId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
  }, [activeId]);

  const renameConversation = useCallback((id: string, title: string) => {
    updateConversation(id, { title });
  }, [updateConversation]);

  const addMessage = useCallback((convId: string, message: Message) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const messages = [...c.messages, message];
        const title = c.messages.length === 0 && message.role === "user"
          ? message.content.substring(0, 60)
          : c.title;
        return { ...c, messages, title, updatedAt: Date.now() };
      }),
    );
  }, []);

  const updateLastMessage = useCallback((convId: string, content: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const messages = [...c.messages];
        if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
          messages[messages.length - 1] = { ...messages[messages.length - 1], content };
        }
        return { ...c, messages, updatedAt: Date.now() };
      }),
    );
  }, []);

  return {
    conversations,
    activeConversation,
    activeId,
    loaded,
    switchConversation,
    newConversation,
    updateConversation,
    deleteConversation,
    renameConversation,
    addMessage,
    updateLastMessage,
  };
}
