import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionChunk } from "groq-sdk/resources/chat/completions";
import * as cheerio from "cheerio";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

const groqFallback = process.env.GROQ_FALLBACK_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_FALLBACK_API_KEY })
  : null;

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

async function scrapeUrls(urls: string[]): Promise<string> {
  let context = "";
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        $("script, style").remove();
        const text = $("body").text().replace(/\s+/g, " ").trim();
        context += `\n\n--- Content from ${url} ---\n${text.substring(0, 5000)}\n--- End Content ---\n`;
      }
    } catch (err) {
      console.error("Error scraping URL:", url, err);
      context += `\n\n--- Error scraping ${url} ---\n`;
    }
  }
  return context;
}

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

  systemContent += `\n\nYou can write and execute JavaScript code. The code runs in a sandboxed iframe in the user's browser with a 10-second timeout.
Available APIs: standard JavaScript (Math, JSON, Date, RegExp, String, Number, Array, Object, Map, Set, Promise, setTimeout, crypto, btoa/atob, TextEncoder, etc.).
No DOM access, no fetch/XMLHttpRequest, no Node.js APIs.

To work with external data:
- If the user provides a URL, scrape it using the server-side fetch tool — the scraped content will appear in the conversation context above. Then write code to process that data.
- If the user uploads a file, the app reads it and includes the content as context.

When asked to analyze data, create visualizations, or process information:
1. Write the code inside a fenced code block with language set to "javascript"
2. Use console.log() to display results which the user can see
3. The user can click "Run" to execute the code and see the output
4. Always explain what the code does before showing it`;
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
