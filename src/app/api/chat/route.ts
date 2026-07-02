import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionChunk } from "groq-sdk/resources/chat/completions";
import * as cheerio from "cheerio";
import FirecrawlApp from "@mendable/firecrawl-js";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

const groqFallback = process.env.GROQ_FALLBACK_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_FALLBACK_API_KEY })
  : null;

const firecrawl = process.env.FIRECRAWL_API_KEY
  ? new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY })
  : null;

const HTTP_TIMEOUT = 10_000;
const FIRECRAWL_TIMEOUT = 30_000;

async function createCompletionWithFallback(
  params: { messages: ChatCompletionMessageParam[]; model: string; temperature?: number; max_tokens?: number; stream: boolean },
) {
  async function tryClient(client: Groq) {
    return client.chat.completions.create(params);
  }
  try {
    return await tryClient(groq);
  } catch (err) {
    if (groqFallback && isRetryableError(err)) {
      console.warn("Primary Groq key failed, trying fallback");
      return await tryClient(groqFallback);
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
};

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

async function scrapeUrls(urls: string[]): Promise<string> {
  const results = await Promise.allSettled(urls.map(fetchPageContent));

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

async function parsePdfs(pdfs: Attachment[]): Promise<string> {
  let context = "";
  for (const pdf of pdfs) {
    try {
      const base64Data = pdf.data.split(",")[1];
      if (base64Data) {
        const PDFParse = await loadPdfParser();
        const buffer = Buffer.from(base64Data, "base64");
        const parser = new PDFParse({ data: buffer });
        const pdfData = await parser.getText();
        await parser.destroy();
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
): ChatCompletionMessageParam[] {
  const formatted: ChatCompletionMessageParam[] = [];

  let systemContent = `You are Aura, an intelligent AI assistant. Be helpful, concise, and friendly.`;
  if (customInstructions) {
    systemContent += `\n\nCustom instructions: ${customInstructions}`;
  }
  if (scrapedContext) {
    systemContent += `\n\nYou have been provided with the following scraped webpage context. Use it to answer the user's queries if relevant.\n${scrapedContext}`;
  }

  systemContent += `\n\nIMPORTANT: You have JavaScript code execution capability, but ONLY use it when the user explicitly asks you to analyze data, create visualizations, process information, or write code. Do NOT write JavaScript code in your responses unless specifically requested.

When you ARE asked to do data analysis or visualization:
1. Write the code inside a fenced code block with language set to "javascript"
2. Use console.log() to display results
3. Available: Math, JSON, Date, RegExp, Array, Map, Set, Promise, setTimeout, crypto, btoa/atob, TextEncoder — NO DOM, NO fetch, NO Node.js
4. For external data, the app already scrapes URLs you provide — the content is in the conversation context above`;
  formatted.push({ role: "system", content: systemContent.trim() });

  const lastMessage = messages[messages.length - 1];
  const previousMessages = messages.slice(0, -1);

  for (const msg of previousMessages) {
    if (msg.role === "system") {
      formatted.push({ role: "system", content: msg.content as string });
    } else if (msg.role === "user") {
      formatted.push({ role: "user", content: msg.content as string });
    } else {
      formatted.push({ role: "assistant", content: msg.content as string });
    }
  }

  if (images.length > 0) {
    const text = typeof lastMessage.content === "string"
      ? lastMessage.content
      : "Please analyze this image.";
    const contentArray: ImageContentPart[] = [
      { type: "text", text: text || "Please analyze this image." },
    ];
    for (const img of images) {
      contentArray.push({ type: "image_url", image_url: { url: img.data } });
    }
    formatted.push({ role: "user", content: contentArray });
  } else {
    if (lastMessage.role === "system") {
      formatted.push({ role: "system", content: lastMessage.content as string });
    } else if (lastMessage.role === "user") {
      formatted.push({ role: "user", content: lastMessage.content as string });
    } else {
      formatted.push({ role: "assistant", content: lastMessage.content as string });
    }
  }

  return formatted;
}

// ─── Route ───

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      messages?: Message[];
      attachments?: Attachment[];
      customInstructions?: string;
    };

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "Invalid messages format" }, { status: 400 });
    }

    const [scrapedContext, pdfContext] = await Promise.all([
      scrapeUrls(body.attachments?.filter((a: Attachment) => a.type === "url").map((a: Attachment) => a.data) || []),
      parsePdfs(body.attachments?.filter((a: Attachment) => a.type === "pdf") || []),
    ]);
    const combinedContext = scrapedContext + pdfContext;

    const images = body.attachments?.filter((a: Attachment) => a.type === "image") || [];
    const formattedMessages = buildMessages(body.messages, combinedContext, images, body.customInstructions || "");

    const model = images.length > 0 ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.3-70b-versatile";

    const stream = await createCompletionWithFallback({
      messages: formattedMessages,
      model,
      temperature: 0.5,
      max_tokens: 2048,
      stream: true,
    }) as AsyncIterable<ChatCompletionChunk>;

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let fullReply = "";

        try {
          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content || "";
            if (token) {
              fullReply += token;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
            }
          }

          // Generate follow-up suggestions
          let suggestions: string[] = [];
          try {
            const suggestCompletion = await createCompletionWithFallback({
              messages: [
                { role: "system", content: "Generate 3 short follow-up questions the user might ask next based on this conversation. Return only a JSON array of strings, nothing else." },
                ...formattedMessages,
                { role: "assistant", content: fullReply },
              ],
              model: "llama-3.3-70b-versatile",
              temperature: 0.7,
              max_tokens: 200,
              stream: false,
            }) as { choices: { message?: { content?: string } }[] };
            const raw = suggestCompletion.choices[0]?.message?.content || "[]";
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) suggestions = parsed.slice(0, 3);
          } catch {
            // suggestions silently fail
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, suggestions })}\n\n`));
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`));
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
