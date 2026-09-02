import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import FirecrawlApp from "@mendable/firecrawl-js";

export const runtime = "nodejs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-4o";

const openAiKey = process.env.OPENAI_API_KEY || "";
const openAiFallbackKey = process.env.OPENAI_FALLBACK_API_KEY || "";

const firecrawl = process.env.FIRECRAWL_API_KEY
  ? new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY })
  : null;

const HTTP_TIMEOUT = 10_000;
const FIRECRAWL_TIMEOUT = 30_000;

type InputContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

type InputMessage = {
  role: "system" | "user" | "assistant";
  content: string | InputContentPart[];
};

type CompletionParams = {
  instructions?: string;
  input: InputMessage[];
  model: string;
  max_output_tokens?: number;
  stream: boolean;
};

type ResponseOutput = {
  output?: { type: string; content?: { type: string; text?: string }[] }[];
};

async function requestWithKey(apiKey: string, params: CompletionParams) {
  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`OpenAI API error ${res.status}: ${detail}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (params.stream) {
    return streamCompletion(res);
  }
  return res.json();
}

// The Responses API streams typed SSE events; assistant text arrives as
// `response.output_text.delta` events whose `delta` field carries the token.
async function* streamCompletion(res: Response): AsyncIterable<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as { type?: string; delta?: string };
        if (event.type === "response.output_text.delta" && event.delta) {
          yield event.delta;
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}

function extractOutputText(response: ResponseOutput): string {
  let text = "";
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) text += part.text;
    }
  }
  return text;
}

async function createCompletionWithFallback(params: CompletionParams) {
  try {
    return await requestWithKey(openAiKey, params);
  } catch (err) {
    if (openAiFallbackKey && isRetryableError(err)) {
      console.warn("Primary OpenAI key failed, trying fallback");
      return await requestWithKey(openAiFallbackKey, params);
    }
    throw err;
  }
}

function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status === 429 || status === 502 || status === 503 || status === 401;
}

type Attachment = {
  type: "image" | "url" | "pdf";
  data: string;
  name?: string;
};

// Progress events streamed to the client before/while the model responds.
export type StatusEvent =
  | { status: "visiting"; url: string }
  | { status: "visited"; url: string; ok: boolean }
  | { status: "reading_pdf"; name?: string }
  | { status: "read_pdf"; name?: string }
  | { status: "thinking" };

type ImageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type Message = {
  role: "user" | "assistant" | "system";
  content: string | ImageContentPart[];
};

async function loadPdfParser() {
  try {
    const canvas = await import("@napi-rs/canvas");
    globalThis.DOMMatrix ??= canvas.DOMMatrix as unknown as typeof DOMMatrix;
    globalThis.ImageData ??= canvas.ImageData as unknown as typeof ImageData;
    globalThis.Path2D ??= canvas.Path2D as unknown as typeof Path2D;
  } catch (e) {
    console.warn("Failed to polyfill canvas APIs:", e);
  }
  const { PDFParse } = await import("pdf-parse");
  return PDFParse;
}

// ─── Web scraping ───

function extractWithCheerio(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, aside").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function needsFallback(html: string, extractedText: string): boolean {
  return (
    html.length < 1500 ||
    extractedText.length < 300 ||
    /enable javascript/i.test(html) ||
    /checking your browser/i.test(html) ||
    /captcha/i.test(html) ||
    /attention.*required/i.test(html) ||
    /cloudflare/i.test(html)
  );
}

async function fetchPage(url: string): Promise<{ html: string; from: "fetch" } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) return null;

    const html = await res.text();
    return { html, from: "fetch" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function extractWithFirecrawl(url: string): Promise<string | null> {
  if (!firecrawl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT);

  try {
    const result = await firecrawl.scrapeUrl(url, { formats: ["markdown"] }) as { markdown?: string };
    return result.markdown?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageContent(url: string): Promise<string> {
  // Fast path: HTTP fetch + Cheerio
  const fetched = await fetchPage(url);
  if (fetched) {
    const text = extractWithCheerio(fetched.html);
    if (!needsFallback(fetched.html, text)) {
      return text.substring(0, 10_000);
    }
  }

  // Slow path: Firecrawl fallback
  const md = await extractWithFirecrawl(url);
  if (md) {
    return md.substring(0, 10_000);
  }

  // Final fallback: return whatever text we got from fast path
  if (fetched) {
    const text = extractWithCheerio(fetched.html);
    if (text) return text.substring(0, 10_000);
  }

  return "";
}

// Users often paste links directly into the chat instead of using the
// attach-link button; pick those up so they get scraped too.
function extractInlineUrls(messages: Message[]): string[] {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = typeof lastUser?.content === "string" ? lastUser.content : "";
  return (text.match(/https?:\/\/[^\s<>"')\]]+/g) || []).map((url) =>
    url.replace(/[.,;:!?)\]]+$/, ""),
  );
}

async function scrapeUrls(urls: string[], onStatus: (event: StatusEvent) => void): Promise<string> {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      onStatus({ status: "visiting", url });
      const content = await fetchPageContent(url);
      onStatus({ status: "visited", url, ok: !!content });
      return content;
    }),
  );

  let context = "";
  for (let i = 0; i < urls.length; i++) {
    const result = results[i];
    const url = urls[i];
    if (result.status === "fulfilled" && result.value) {
      context += `\n\n--- Content from ${url} ---\n${result.value}\n--- End Content ---\n`;
    } else {
      context += `\n\n--- Could not retrieve content from ${url} ---\n`;
    }
  }
  return context;
}

// ─── PDF parsing ───

async function parsePdfs(pdfs: Attachment[], onStatus: (event: StatusEvent) => void): Promise<string> {
  let context = "";
  for (const pdf of pdfs) {
    try {
      const base64Data = pdf.data.split(",")[1];
      if (base64Data) {
        onStatus({ status: "reading_pdf", name: pdf.name });
        const PDFParse = await loadPdfParser();
        const buffer = Buffer.from(base64Data, "base64");
        const parser = new PDFParse({ data: buffer });
        const pdfData = await parser.getText();
        await parser.destroy();
        onStatus({ status: "read_pdf", name: pdf.name });
        context += `\n\n--- Content from PDF ---\n${pdfData.text.substring(0, 10000)}\n--- End Content ---\n`;
      }
    } catch (err) {
      console.error("Error parsing PDF:", err);
      context += `\n\n--- Error reading PDF ---\n`;
    }
  }
  return context;
}

// ─── Message building ───

function buildMessages(
  messages: Message[],
  scrapedContext: string,
  images: Attachment[],
  customInstructions: string,
): { instructions: string; input: InputMessage[] } {
  const input: InputMessage[] = [];

  let systemContent = `You are Aura, an intelligent AI assistant. Be helpful, concise, and friendly.

You cannot browse the web by yourself, but this app automatically scrapes any URL the user shares (inline in their message or as an attachment) and provides the page content to you in this conversation. Therefore:
- If webpage content has been provided in context below, you HAVE effectively visited that page — answer questions about it based on that content. Never claim you cannot access a URL whose content is in the context.
- If the user asks you to visit a URL but no content for it appears in the context, do NOT say "I can't browse the web." Instead, tell them the page content could not be retrieved and ask them to share the link again.`;
  if (customInstructions) {
    systemContent += `\n\nCustom instructions: ${customInstructions}`;
  }
  if (scrapedContext) {
    systemContent += `\n\nYou have been provided with the following scraped webpage context. Use it to answer the user's queries if relevant. If content for a URL is included, treat it as the page's content — do not claim you cannot access it. If a URL's content could not be retrieved, say so plainly and ask the user to re-share the link.\n${scrapedContext}`;
  }

  const instructions = `${systemContent}

IMPORTANT: You have JavaScript code execution capability, but ONLY use it when the user explicitly asks you to analyze data, create visualizations, process information, or write code. Do NOT write JavaScript code in your responses unless specifically requested.

When you ARE asked to do data analysis or visualization:
1. Write the code inside a fenced code block with language set to "javascript"
2. Use console.log() to display results
3. Available: Math, JSON, Date, RegExp, Array, Map, Set, Promise, setTimeout, crypto, btoa/atob, TextEncoder — NO DOM, NO fetch, NO Node.js
4. For external data, the app already scrapes URLs you provide — the content is in the conversation context above`.trim();

  const lastMessage = messages[messages.length - 1];
  const previousMessages = messages.slice(0, -1);

  for (const msg of previousMessages) {
    if (msg.role === "system") {
      input.push({ role: "system", content: msg.content as string });
    } else if (msg.role === "user") {
      input.push({ role: "user", content: msg.content as string });
    } else {
      input.push({ role: "assistant", content: msg.content as string });
    }
  }

  if (images.length > 0) {
    const text = typeof lastMessage.content === "string"
      ? lastMessage.content
      : "Please analyze this image.";
    const contentParts: InputContentPart[] = [
      { type: "input_text", text: text || "Please analyze this image." },
    ];
    for (const img of images) {
      contentParts.push({ type: "input_image", image_url: img.data });
    }
    input.push({ role: "user", content: contentParts });
  } else {
    if (lastMessage.role === "system") {
      input.push({ role: "system", content: lastMessage.content as string });
    } else if (lastMessage.role === "user") {
      input.push({ role: "user", content: lastMessage.content as string });
    } else {
      input.push({ role: "assistant", content: lastMessage.content as string });
    }
  }

  return { instructions, input };
}

// ─── Route ───

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      messages?: Message[];
      attachments?: Attachment[];
      customInstructions?: string;
    };

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "Invalid messages format" }, { status: 400 });
    }
    const messages = body.messages as Message[];
    const attachments = body.attachments || [];

    const attachmentUrls =
      attachments.filter((a: Attachment) => a.type === "url").map((a: Attachment) => a.data);
    const urls = [...new Set([...attachmentUrls, ...extractInlineUrls(messages)])].slice(0, 5);
    const pdfs = attachments.filter((a: Attachment) => a.type === "pdf");
    const images = attachments.filter((a: Attachment) => a.type === "image");

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        // Scrape/PDF parsing happens inside the stream so the client sees
        // live progress events instead of waiting on a silent connection.
        const emit = (payload: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

        let fullReply = "";

        try {
          const [scrapedContext, pdfContext] = await Promise.all([
            scrapeUrls(urls, emit),
            parsePdfs(pdfs, emit),
          ]);
          const combinedContext = scrapedContext + pdfContext;

          const { instructions, input } = buildMessages(messages, combinedContext, images, body.customInstructions || "");

          emit({ status: "thinking" });

          const stream = await createCompletionWithFallback({
            instructions,
            input,
            model: MODEL,
            max_output_tokens: 2048,
            stream: true,
          }) as AsyncIterable<string>;

          for await (const token of stream) {
            fullReply += token;
            emit({ token });
          }

          // Generate follow-up suggestions
          let suggestions: string[] = [];
          try {
            const suggestCompletion = await createCompletionWithFallback({
              instructions: "Generate 3 short follow-up questions the user might ask next based on this conversation. Return only a JSON array of strings, nothing else.",
              input: [...input, { role: "assistant", content: fullReply }],
              model: MODEL,
              max_output_tokens: 200,
              stream: false,
            }) as ResponseOutput;
            const raw = extractOutputText(suggestCompletion) || "[]";
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) suggestions = parsed.slice(0, 3);
          } catch {
            // suggestions silently fail
          }

          emit({ done: true, suggestions });
        } catch (err) {
          emit({ error: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    console.error("API Error:", error);
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
