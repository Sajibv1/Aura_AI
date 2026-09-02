"use client";

import { useState, useRef, useEffect, useCallback, ChangeEvent, FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import {
  CheckIcon,
  FileTextIcon,
  ImageIcon,
  LinkIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";

import { useConversations } from "@/hooks/useConversations";
import { useChat, type Attachment as ChatAttachment, type StatusEvent } from "@/hooks/useChat";
import { useTheme } from "@/hooks/useTheme";
import { useCustomInstructions } from "@/hooks/useCustomInstructions";
import { Sidebar } from "@/components/Sidebar";
import { CodeBlock } from "@/components/CodeBlock";
import type { Components } from "react-markdown";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ExportButton } from "@/components/ExportButton";
import { CustomInstructionsModal } from "@/components/CustomInstructionsModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { cn } from "@/lib/utils";

type ActivityItem = {
  key: string;
  text: string;
  state: "active" | "done" | "failed";
};

function shortUrl(url: string): string {
  const stripped = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return stripped.length > 40 ? `${stripped.slice(0, 40)}…` : stripped;
}

export function ChatClient() {
  const themeHook = useTheme();
  const instructionsHook = useCustomInstructions();
  const chat = useChat();

  const {
    conversations, activeConversation, activeId, loaded,
    switchConversation, newConversation, addMessage,
    updateLastMessage, deleteConversation, renameConversation,
  } = useConversations();

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [initDone, setInitDone] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialise first conversation
  useEffect(() => {
    if (loaded && !initDone) {
      setInitDone(true);
      if (conversations.length === 0) {
        newConversation();
      }
    }
  }, [loaded, conversations.length, newConversation, initDone]);

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
    setActivity([]);
    setAttachments([]);
    setInput("");
  }, [newConversation]);

  const handleSelectConv = useCallback((id: string) => {
    switchConversation(id);
    setStreamingContent("");
    setSuggestions([]);
    setActivity([]);
  }, [switchConversation]);

  const handleStatus = useCallback((s: StatusEvent) => {
    setActivity((prev) => {
      switch (s.status) {
        case "visiting":
          return [...prev, { key: s.url, text: `Visiting ${shortUrl(s.url)}`, state: "active" as const }];
        case "visited":
          return prev.map((a) =>
            a.key === s.url
              ? { ...a, state: s.ok ? ("done" as const) : ("failed" as const), text: s.ok ? `Read ${shortUrl(s.url)}` : `Couldn't access ${shortUrl(s.url)}` }
              : a,
          );
        case "reading_pdf":
          return [...prev, { key: `pdf:${s.name ?? ""}`, text: `Reading ${s.name || "PDF"}`, state: "active" as const }];
        case "read_pdf":
          return prev.map((a) => (a.key === `pdf:${s.name ?? ""}` ? { ...a, state: "done" as const } : a));
        case "searching":
          return [...prev, { key: `search:${s.query}`, text: `Searching "${s.query}"`, state: "active" as const }];
        case "searched":
          return prev.map((a) =>
            a.key === `search:${s.query}`
              ? { ...a, state: s.ok ? ("done" as const) : ("failed" as const), text: s.ok ? `Searched "${s.query}"` : `No results for "${s.query}"` }
              : a,
          );
        case "running_code": {
          // The model may run code several times in one answer; give each
          // run its own entry keyed by how many have come before.
          const n = prev.filter((a) => a.key.startsWith("code:")).length;
          return [...prev, { key: `code:${n}`, text: "Running JavaScript…", state: "active" as const }];
        }
        case "ran_code":
          return prev.map((a) =>
            a.key.startsWith("code:") && a.state === "active"
              ? { ...a, state: s.ok ? ("done" as const) : ("failed" as const), text: s.ok ? "Ran JavaScript" : "JavaScript error" }
              : a,
          );
        case "thinking":
          // The agent loop emits "thinking" once per round; show it only once
          return prev.some((a) => a.key === "thinking")
            ? prev
            : [...prev, { key: "thinking", text: "Thinking…", state: "active" as const }];
      }
    });
  }, []);

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
    setActivity([]);

    // Add empty assistant message placeholder for streaming
    addMessage(activeId, { role: "assistant", content: "" });

    chat.send(apiMessages, currentAttachments, instructionsHook.instructions, {
      onStatus: handleStatus,
      onToken(token) {
        setStreamingContent((prev) => prev + token);
        // The answer is streaming now — the activity log has served its purpose
        setActivity((prev) => (prev.length ? [] : prev));
      },
      onDone(full, newSuggestions) {
        setStreamingContent("");
        setActivity([]);
        updateLastMessage(activeId!, full);
        setSuggestions(newSuggestions);
      },
      onError(err) {
        setStreamingContent("");
        setActivity([]);
        updateLastMessage(activeId!, `Error: ${err}`);
      },
    });
  }, [input, attachments, activeId, addMessage, conversations, chat, instructionsHook.instructions, updateLastMessage, handleStatus]);

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

  if (!loaded) {
    return (
      <div className="flex h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <div className="flex h-svh">
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

      <main
        className="relative flex min-w-0 flex-1 flex-col"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-ring/50 bg-background/80">
            <span className="text-sm text-muted-foreground">Drop file here</span>
          </div>
        )}

        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-muted-foreground" />
            <h1 className="text-base font-semibold tracking-tight">Aura</h1>
            <Badge variant="secondary" className="hidden sm:inline-flex">gpt-4o</Badge>
          </div>
          <div className="flex items-center gap-0.5">
            <ExportButton conversation={activeConversation} />
            <CustomInstructionsModal value={instructionsHook.instructions} onChange={instructionsHook.setInstructions} />
            <ThemeToggle theme={themeHook.theme} onToggle={themeHook.toggle} />
          </div>
        </header>

        <MessageScrollerProvider>
          <MessageScroller className="mx-auto w-full max-w-5xl">
            <MessageScrollerViewport>
              <MessageScrollerContent className="px-4 py-6">
                {messages.length === 0 ? (
                  <Empty className="m-auto">
                    <EmptyHeader>
                      <EmptyMedia>
                        <SparklesIcon />
                      </EmptyMedia>
                      <EmptyTitle className="text-xl">Aura</EmptyTitle>
                      <EmptyDescription>
                        Your intelligent multi-modal assistant — it can search
                        the web, read pages you share, and analyze images and
                        PDFs.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent className="flex-row flex-wrap justify-center">
                      <Badge variant="outline">
                        <ImageIcon data-icon="inline-start" />
                        Attach images for analysis
                      </Badge>
                      <Badge variant="outline">
                        <LinkIcon data-icon="inline-start" />
                        Share URLs for context
                      </Badge>
                      <Badge variant="outline">
                        <FileTextIcon data-icon="inline-start" />
                        Upload PDFs to extract text
                      </Badge>
                    </EmptyContent>
                  </Empty>
                ) : (
                  messages.map((msg, idx) => {
                    const isStreaming =
                      idx === messages.length - 1 && msg.role === "assistant" && msg.content === "";
                    return (
                      <MessageScrollerItem
                        key={idx}
                        messageId={String(idx)}
                        scrollAnchor={msg.role === "user"}
                      >
                        <Message align={msg.role === "user" ? "end" : "start"}>
                          <MessageAvatar>
                            {msg.role === "assistant" ? (
                              <SparklesIcon className="size-4" />
                            ) : (
                              <span className="text-xs font-semibold">U</span>
                            )}
                          </MessageAvatar>
                          <MessageContent>
                            <Bubble variant={msg.role === "user" ? "default" : "muted"}>
                              <BubbleContent
                                className={msg.role === "assistant" ? "markdown-body" : "whitespace-pre-wrap"}
                              >
                                {msg.role === "assistant" ? (
                                  <ReactMarkdown components={markdownComponents}>
                                    {isStreaming ? streamingContent || "" : msg.content}
                                  </ReactMarkdown>
                                ) : (
                                  msg.content
                                )}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    );
                  })
                )}

                {chat.isLoading && activity.length > 0 && (
                  <MessageScrollerItem scrollAnchor={false}>
                    <div className="flex flex-col gap-1.5 pl-10">
                      {activity.map((a) => (
                        <Marker key={a.key} role="status">
                          <MarkerIcon>
                            {a.state === "active" ? (
                              <Spinner />
                            ) : a.state === "done" ? (
                              <CheckIcon />
                            ) : (
                              <XIcon className="text-destructive" />
                            )}
                          </MarkerIcon>
                          <MarkerContent
                            className={a.state === "failed" ? "text-destructive" : undefined}
                          >
                            {a.text}
                          </MarkerContent>
                        </Marker>
                      ))}
                    </div>
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>

        {suggestions.length > 0 && (
          <div className="mx-auto w-full max-w-5xl px-4 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Follow-up:</span>
              {suggestions.map((s, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => handleSuggestionClick(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto w-full max-w-5xl px-4 pb-4">
          <form onSubmit={handleSend}>
            {attachments.length > 0 && (
              <AttachmentGroup className="mb-2 py-0">
                {attachments.map((att, idx) => (
                  <Attachment key={idx} size="sm">
                    <AttachmentMedia variant={att.type === "image" ? "image" : "icon"}>
                      {att.type === "image" ? (
                        <img src={att.data} alt="" />
                      ) : att.type === "pdf" ? (
                        <FileTextIcon />
                      ) : (
                        <LinkIcon />
                      )}
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{att.name || (att.type === "image" ? "Image" : att.data)}</AttachmentTitle>
                    </AttachmentContent>
                    <AttachmentActions>
                      <AttachmentAction
                        aria-label="Remove attachment"
                        onClick={() => removeAttachment(idx)}
                      >
                        <XIcon />
                      </AttachmentAction>
                    </AttachmentActions>
                  </Attachment>
                ))}
              </AttachmentGroup>
            )}

            <InputGroup>
              <InputGroupTextarea
                placeholder="Ask anything… paste a link or attach files for context"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="min-h-12 max-h-48 overflow-y-auto"
              />
              <InputGroupAddon align="block-end" className="gap-0.5 p-1.5">
                <Popover open={showUrlInput} onOpenChange={setShowUrlInput}>
                  <PopoverTrigger
                    render={
                      <InputGroupButton
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Attach link"
                      />
                    }
                  >
                    <LinkIcon />
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-2">
                    <form onSubmit={handleAddUrl} className="flex gap-2">
                      <Input
                        autoFocus
                        type="url"
                        placeholder="https://example.com"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                      />
                      <Button type="submit" size="sm">Add</Button>
                    </form>
                  </PopoverContent>
                </Popover>

                <InputGroupButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Upload image or PDF"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon />
                </InputGroupButton>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  ref={fileInputRef}
                  hidden
                  onChange={onFileInputChange}
                />

                <div className="ml-auto">
                  {chat.isLoading ? (
                    <InputGroupButton
                      variant="default"
                      size="icon-sm"
                      aria-label="Stop generating"
                      onClick={chat.cancel}
                    >
                      <SquareIcon />
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton
                      variant="default"
                      size="icon-sm"
                      type="submit"
                      aria-label="Send message"
                      disabled={!input.trim() && attachments.length === 0}
                      className={cn(
                        "transition-opacity",
                        !input.trim() && attachments.length === 0 && "opacity-50",
                      )}
                    >
                      <SendIcon />
                    </InputGroupButton>
                  )}
                </div>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </div>
      </main>
    </div>
  );
}
