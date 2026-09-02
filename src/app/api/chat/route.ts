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

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

type InputContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

type InputMessage = {
  role: "system" | "user" | "assistant";
  content: string | InputContentPart[];
};

type FunctionCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

type FunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

type InputItem = InputMessage | FunctionCall | FunctionCallOutput;

type CompletionParams = {
  instructions?: string;
  input: InputItem[];
  model: string;
  max_output_tokens?: number;
  stream: boolean;
  tools?: unknown[];
  previous_response_id?: string;
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
    return res;
  }
  return res.json();
}

// The Responses API streams typed SSE events. Text tokens arrive as
// `response.output_text.delta`; tool calls as completed `function_call`
// output items; `response.completed` carries the response id needed to
// continue the conversation after running tools.
type SseEvent = {
  type?: string;
  delta?: string;
  item?: { type?: string } & Record<string, unknown>;
  response?: { id?: string };
  [key: string]: unknown;
};

async function* streamResponseEvents(res: Response): AsyncIterable<SseEvent> {
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
        yield JSON.parse(data) as SseEvent;
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
  | { status: "searching"; query: string }
  | { status: "searched"; query: string; ok: boolean }
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
        "User-Agent": BROWSER_USER_AGENT,
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

// ─── Web search (DuckDuckGo) ───

const SEARCH_TOOL = {
  type: "function",
  name: "web_search",
  description:
    "Search the web using DuckDuckGo. Use this whenever the user asks about current events, recent news, prices, or any facts you are unsure about and don't already have in context. Returns the top results with snippets plus the extracted text of the top pages.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
} as const;

type SearchResult = { title: string; url: string; snippet: string };

// DuckDuckGo's HTML endpoint needs no API key; result links are wrapped in
// a redirect (`//duckduckgo.com/l/?uddg=<encoded url>`) that we unwrap.
async function duckDuckGoSearch(query: string): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": BROWSER_USER_AGENT,
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: new URLSearchParams({ q: query }).toString(),
    });

    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);

    const results: SearchResult[] = [];
    $(".result").each((_, el) => {
      const link = $(el).find("a.result__a");
      const href = link.attr("href") || "";
      const uddg = href.match(/uddg=([^&]+)/);
      const url = uddg ? decodeURIComponent(uddg[1]) : href.startsWith("http") ? href : "";
      const title = link.text().trim();
      const snippet = $(el).find(".result__snippet").text().trim();
      if (title && url) results.push({ title, url, snippet });
    });
    return results.slice(0, 6);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function webSearch(query: string, emit: (payload: unknown) => void): Promise<string> {
  emit({ status: "searching", query });
  const results = await duckDuckGoSearch(query);
  if (results.length === 0) {
    emit({ status: "searched", query, ok: false });
    return `No results found for "${query}" on DuckDuckGo.`;
  }
  emit({ status: "searched", query, ok: true });

  // Fetch the top pages so the model can answer from real content,
  // not just snippets.
  const top = results.slice(0, 3);
  const pages = await Promise.all(
    top.map(async (r) => {
      emit({ status: "visiting", url: r.url });
      const fetched = await fetchPage(r.url);
      const content = fetched ? extractWithCheerio(fetched.html).substring(0, 3000) : "";
      emit({ status: "visited", url: r.url, ok: !!content });
      return { ...r, content };
    }),
  );

  let output = `DuckDuckGo results for "${query}":\n`;
  for (const r of results) {
    output += `\n- ${r.title} (${r.url})\n  ${r.snippet}`;
  }
  output += "\n\nExtracted page content:\n";
  for (const p of pages) {
    output += `\n--- ${p.title} (${p.url}) ---\n${p.content || "(could not fetch page)"}\n`;
  }
  return output;
}

// Runs the model with the web_search tool available, executing searches
// between rounds until the model produces a final answer. Text tokens are
// yielded as they stream; tool calls are resolved and fed back via
// previous_response_id.
async function* agentStream(
  params: CompletionParams,
  emit: (payload: unknown) => void,
): AsyncGenerator<string> {
  let previousResponseId: string | undefined;
  let input: InputItem[] = params.input;

  // Cap the number of search rounds so a confused model can't loop forever.
  for (let round = 0; round < 4; round++) {
    emit({ status: "thinking" });

    const res = await createCompletionWithFallback({
      ...params,
      input,
      previous_response_id: previousResponseId,
      tools: [SEARCH_TOOL],
      stream: true,
    }) as Response;

    const calls: FunctionCall[] = [];
    for await (const event of streamResponseEvents(res)) {
      if (event.type === "response.output_text.delta" && event.delta) {
        yield event.delta;
      } else if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
        calls.push(event.item as unknown as FunctionCall);
      } else if (event.type === "response.completed" && event.response?.id) {
        previousResponseId = event.response.id;
      }
    }

    if (calls.length === 0) return;

    input = [];
    for (const call of calls) {
      let output: string;
      try {
        const args = JSON.parse(call.arguments || "{}") as { query?: string };
        if (call.name === "web_search" && args.query) {
          output = await webSearch(args.query, emit);
        } else {
          output = "Error: unknown tool or missing query.";
        }
      } catch (err) {
        output = `Error: ${(err as Error).message}`;
      }
      input.push({ type: "function_call_output", call_id: call.call_id, output });
    }
  }
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

You have a web_search tool that searches DuckDuckGo. Whenever the user asks about current events, recent news, or anything you are unsure about and don't already have in context, call web_search yourself — do not ask the user to search or claim you cannot. Answer from the search results you receive and cite the source URLs.

The app also automatically scrapes any URL the user shares (inline in their message or as an attachment) and provides the page content to you in this conversation. Therefore:
- If webpage content has been provided in context below, you HAVE effectively visited that page — answer questions about it based on that content. Never claim you cannot access a URL whose content is in the context.
- If the user asks you to visit a URL but no content for it appears in the context, call web_search for it or tell them the page content could not be retrieved.`;
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

          const stream = agentStream(
            { instructions, input, model: MODEL, max_output_tokens: 2048, stream: true },
            emit,
          );

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
