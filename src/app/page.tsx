"use client";

import { useState, useRef, useEffect, useCallback, ChangeEvent, FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import {
  Send, Image as ImageIcon, Link as LinkIcon, X, Loader2, FileText, LogOut, Sparkles,
} from "lucide-react";
import { useSession, signIn, signOut } from "next-auth/react";
import { useConversations } from "@/hooks/useConversations";
import { useChat, type Attachment } from "@/hooks/useChat";
import { useTheme } from "@/hooks/useTheme";
import { useCustomInstructions } from "@/hooks/useCustomInstructions";
import { Sidebar } from "@/components/Sidebar";
import { CodeBlock } from "@/components/CodeBlock";
import type { Components } from "react-markdown";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ExportButton } from "@/components/ExportButton";
import { CustomInstructionsModal } from "@/components/CustomInstructionsModal";

export default function Home() {
  const { data: session, status } = useSession();
  const loading = status === "loading";
  const themeHook = useTheme();
  const instructionsHook = useCustomInstructions();
  const chat = useChat();

  const {
    conversations, activeConversation, activeId, loaded,
    switchConversation, newConversation, addMessage,
    updateLastMessage, deleteConversation, renameConversation,
  } = useConversations();

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [initDone, setInitDone] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Initialise first conversation
  useEffect(() => {
    if (loaded && !initDone) {
      setInitDone(true);
      if (conversations.length === 0) {
        newConversation();
      }
    }
  }, [loaded, conversations.length, newConversation, initDone]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages, streamingContent]);

  const handleFileUpload = useCallback((file: File) => {
    const isPdf = file.type === "application/pdf";
    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachments((prev) => [...prev, { type: isPdf ? "pdf" : "image", data: reader.result as string, name: file.name }]);
    };
    reader.readAsDataURL(file);
  }, []);

  const onFileInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
      e.target.value = "";
    }
  }, [handleFileUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith("image/") || file.type === "application/pdf")) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleAddUrl = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (urlInput.trim() && (urlInput.startsWith("http://") || urlInput.startsWith("https://"))) {
      setAttachments((prev) => [...prev, { type: "url", data: urlInput.trim() }]);
      setUrlInput("");
      setShowUrlInput(false);
    }
  }, [urlInput]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleNewChat = useCallback(() => {
    newConversation();
    setStreamingContent("");
    setSuggestions([]);
    setAttachments([]);
    setInput("");
  }, [newConversation]);

  const handleSelectConv = useCallback((id: string) => {
    switchConversation(id);
    setStreamingContent("");
    setSuggestions([]);
  }, [switchConversation]);

  const handleSend = useCallback(async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() && attachments.length === 0) return;
    if (!activeId) return;

    const currentAttachments = [...attachments];
    setAttachments([]);
    setSuggestions([]);

    const userContent = input.trim();
    setInput("");

    if (!userContent && currentAttachments.length === 0) return;

    // Add user message
    addMessage(activeId, { role: "user", content: userContent || "(attachment sent)" });

    // Prepare messages for API
    const conv = conversations.find((c) => c.id === activeId);
    const apiMessages = conv ? [...conv.messages, { role: "user" as const, content: userContent || "(attachment sent)" }] : [];

    setStreamingContent("");

    // Add empty assistant message placeholder for streaming
    addMessage(activeId, { role: "assistant", content: "" });

    chat.send(apiMessages, currentAttachments, instructionsHook.instructions, {
      onToken(token) {
        setStreamingContent((prev) => prev + token);
      },
      onDone(full, newSuggestions) {
        setStreamingContent("");
        updateLastMessage(activeId!, full);
        setSuggestions(newSuggestions);
      },
      onError(err) {
        setStreamingContent("");
        updateLastMessage(activeId!, `Error: ${err}`);
      },
    });
  }, [input, attachments, activeId, addMessage, conversations, chat, instructionsHook.instructions, updateLastMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInput(suggestion);
    setSuggestions([]);
  }, []);

  const messages = activeConversation?.messages || [];

  const markdownComponents: Components = {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      if (match) {
        return <CodeBlock language={match[1]} code={String(children).replace(/\n$/, "")} />;
      }
      return <code className={className} {...props}>{children}</code>;
    },
  };

  if (loading) {
    return (
      <div className="app-layout" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="typing-indicator" style={{ transform: "scale(2)" }}>
          <div className="typing-dot" />
          <div className="typing-dot" />
          <div className="typing-dot" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-layout login-page">
        <div className="login-card">
          <h1 className="login-title">Aura</h1>
          <p className="login-desc">Your Intelligent Multi-modal RAG Assistant</p>
          <button className="login-google-btn" onClick={() => signIn("google")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Sign in with Google
          </button>
        </div>
        <div className="login-credit">Nur Mohammod Sajib</div>
      </div>
    );
  }

  return (
    <div className={`app-layout ${dragOver ? "drag-over" : ""}`} ref={dropRef}>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConv}
        onNew={handleNewChat}
        onDelete={deleteConversation}
        onRename={renameConversation}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />

      <main className="main-area">
        <header className="header">
          <div className="header-left">
            <h1>Aura</h1>
          </div>
          <div className="header-right">
            <ExportButton conversation={activeConversation} />
            <CustomInstructionsModal value={instructionsHook.instructions} onChange={instructionsHook.setInstructions} />
            <ThemeToggle theme={themeHook.theme} onToggle={themeHook.toggle} />
            {session?.user?.name && (
              <span className="user-name">{session.user.name}</span>
            )}
            <button className="icon-btn" onClick={() => signOut()} title="Sign Out">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div
          className="chat-container"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {dragOver && <div className="drop-overlay"><div className="drop-indicator">Drop file here</div></div>}

          {messages.length === 0 && !chat.isLoading ? (
            <div className="welcome">
              <div className="welcome-logo"><Sparkles size={32} /></div>
              <h2>Aura</h2>
              <p>Your Intelligent Multi-modal RAG Assistant</p>
              <div className="welcome-hints">
                <div className="hint"><ImageIcon size={16} /> Attach images for analysis</div>
                <div className="hint"><LinkIcon size={16} /> Share URLs for context</div>
                <div className="hint"><FileText size={16} /> Upload PDFs to extract text</div>
              </div>
            </div>
          ) : (
            <div className="messages-area">
              {messages.map((msg, idx) => (
                <div key={idx} className={`message ${msg.role}`}>
                  <div className="message-avatar">
                    {msg.role === "assistant" ? (
                      <Sparkles size={16} />
                    ) : session?.user?.image ? (
                      <img src={session.user.image} alt="" className="user-avatar" style={{ width: 34, height: 34, margin: 0, border: "none" }} />
                    ) : (
                      session?.user?.name?.[0] || "U"
                    )}
                  </div>
                  <div className="message-bubble">
                    {msg.role === "assistant" ? (
                      <>
                        <ReactMarkdown components={markdownComponents}>
                          {idx === messages.length - 1 && msg.content === "" ? streamingContent || "" : msg.content}
                        </ReactMarkdown>
                        {idx === messages.length - 1 && msg.content === "" && chat.isLoading && (
                          <span className="stream-cursor" />
                        )}
                      </>
                    ) : (
                      <p>{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="suggestions">
              <p className="suggestions-label">Follow-up questions:</p>
              <div className="suggestions-list">
                {suggestions.map((s, i) => (
                  <button key={i} className="suggestion-chip" onClick={() => handleSuggestionClick(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="input-area">
          <div className="input-wrapper">
            {attachments.length > 0 && (
              <div className="active-attachments">
                {attachments.map((att, idx) => (
                  <div key={idx} className="active-attachment">
                    {att.type === "image" ? (
                      <img src={att.data} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover" }} />
                    ) : att.type === "pdf" ? (
                      <FileText size={14} />
                    ) : (
                      <LinkIcon size={14} />
                    )}
                    <span className="att-name">{att.name || (att.type === "image" ? "Image" : att.data)}</span>
                    <button className="icon-btn-xs" onClick={() => removeAttachment(idx)}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="input-row">
              <div style={{ position: "relative" }}>
                <button type="button" className="icon-btn" onClick={() => setShowUrlInput((v) => !v)} title="Attach Link">
                  <LinkIcon size={20} />
                </button>
                {showUrlInput && (
                  <div className="url-popover">
                    <form onSubmit={handleAddUrl} style={{ display: "flex", gap: "8px" }}>
                      <input autoFocus type="url" placeholder="https://example.com" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
                      <button type="submit">Add</button>
                    </form>
                  </div>
                )}
              </div>

              <button type="button" className="icon-btn" onClick={() => fileInputRef.current?.click()} title="Upload Image or PDF">
                <ImageIcon size={20} />
              </button>
              <input type="file" accept="image/*,application/pdf" ref={fileInputRef} style={{ display: "none" }} onChange={onFileInputChange} />

              <textarea
                className="input-field"
                placeholder="Ask a question or describe the attached file..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />

              <button
                className="send-btn"
                onClick={() => handleSend()}
                disabled={chat.isLoading || (!input.trim() && attachments.length === 0)}
              >
                {chat.isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
