"use client";

import { useState, useRef, useEffect, ChangeEvent, FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { Send, Image as ImageIcon, Link as LinkIcon, X, Loader2 } from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Attachment = {
  type: "image" | "url";
  data: string; // base64 for image, url string for url
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello! I can answer questions, read handwritten/typed text from images, and scrape information from links. How can I help you today?" }
  ]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setAttachments(prev => [...prev, { type: "image", data: base64String }]);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleAddUrl = (e: FormEvent) => {
    e.preventDefault();
    if (urlInput.trim() && (urlInput.startsWith('http://') || urlInput.startsWith('https://'))) {
      setAttachments(prev => [...prev, { type: "url", data: urlInput.trim() }]);
      setUrlInput("");
      setShowUrlInput(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    
    if (!input.trim() && attachments.length === 0) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    
    const currentAttachments = [...attachments];
    setAttachments([]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          attachments: currentAttachments
        })
      });

      if (!response.ok) {
        throw new Error("Failed to fetch response");
      }

      const data = await response.json();
      setMessages([...newMessages, { role: "assistant", content: data.reply }]);
    } catch (error) {
      console.error(error);
      setMessages([...newMessages, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <main className="app-container">
      <header className="header">
        <h1>Aura</h1>
        <p>Your Intelligent Multi-modal RAG Assistant</p>
      </header>

      <section className="chat-container">
        <div className="messages-area">
          {messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <div className="message-bubble">
                {msg.role === "assistant" ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="message assistant">
              <div className="message-bubble">
                <div className="typing-indicator">
                  <div className="typing-dot"></div>
                  <div className="typing-dot"></div>
                  <div className="typing-dot"></div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <div className="input-wrapper">
            {attachments.length > 0 && (
              <div className="active-attachments">
                {attachments.map((att, idx) => (
                  <div key={idx} className="active-attachment">
                    {att.type === 'image' ? (
                      <img src={att.data} alt="Upload" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
                    ) : (
                      <LinkIcon size={14} />
                    )}
                    <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {att.type === 'image' ? 'Image' : att.data}
                    </span>
                    <button onClick={() => removeAttachment(idx)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="input-row">
              <div style={{ position: 'relative' }}>
                <button 
                  type="button" 
                  className="icon-btn" 
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  title="Attach Link"
                >
                  <LinkIcon size={20} />
                </button>
                {showUrlInput && (
                  <div className="url-popover">
                    <form onSubmit={handleAddUrl} style={{ display: 'flex', gap: '8px' }}>
                      <input 
                        autoFocus
                        type="url" 
                        placeholder="https://example.com" 
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                      />
                      <button type="submit">Add</button>
                    </form>
                  </div>
                )}
              </div>

              <button 
                type="button" 
                className="icon-btn" 
                onClick={() => fileInputRef.current?.click()}
                title="Upload Image"
              >
                <ImageIcon size={20} />
              </button>
              <input 
                type="file" 
                accept="image/*" 
                ref={fileInputRef} 
                style={{ display: "none" }} 
                onChange={handleImageUpload}
              />

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
                disabled={isLoading || (!input.trim() && attachments.length === 0)}
              >
                {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
