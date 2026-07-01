"use client";

import { useState, useCallback, useRef } from "react";

export type Attachment = {
  type: "image" | "url" | "pdf";
  data: string;
  name?: string;
};

type StreamCallbacks = {
  onToken: (token: string) => void;
  onDone: (full: string, suggestions: string[]) => void;
  onError: (err: string) => void;
};

export function useChat() {
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (
    messages: { role: string; content: string }[],
    attachments: Attachment[],
    customInstructions: string,
    callbacks: StreamCallbacks,
  ) => {
    setIsLoading(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, attachments, customInstructions }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Request failed" }));
        callbacks.onError(errData.error || `HTTP ${res.status}`);
        setIsLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError("No response body");
        setIsLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let fullReply = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.token) {
              fullReply += data.token;
              callbacks.onToken(data.token);
            }
            if (data.done) {
              callbacks.onDone(fullReply, data.suggestions || []);
            }
            if (data.error) {
              callbacks.onError(data.error);
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      callbacks.onError((err as Error).message || "Something went wrong");
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { isLoading, send, cancel };
}
