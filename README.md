# Aura RAG - Multi-modal Assistant

An intelligent RAG (Retrieval-Augmented Generation) web application built with Next.js 16. It uses the OpenAI Responses API (`gpt-4o`) with support for autonomous web search, web scraping, image analysis, PDF parsing, and sandboxed JavaScript execution as context and computation sources.

## Features

- **Autonomous web search** — the agent decides by itself when to search (via a `web_search` tool), runs the query, reads the top result pages, and answers with citations
- **Autonomous JavaScript execution** — the agent runs its own code in a server-side sandbox (via a `run_javascript` tool) whenever computation helps: arithmetic, date math, data processing, or verifying an answer
- **URL scraping** — links pasted directly in the chat *or* attached via the link button are fetched and injected as context (up to 5 per message)
- **Image analysis** — attached images are passed to the vision-capable model
- **PDF text extraction** — attached PDFs are parsed server-side
- **Live progress feed** — while the agent visits URLs, reads PDFs, searches, or runs code, each step streams to the UI (spinner → check/failure per item)
- **Streaming responses** with follow-up question suggestions
- **Conversation management** — sidebar with persisted conversations, rename, and export
- **Custom instructions**, dark/light theme, and a Run button on JavaScript code blocks for client-side execution

## How It Works

### Architecture

1. **Frontend** (`src/components/ChatClient.tsx`) — chat interface built with shadcn/ui. Users can type text, paste links inline, or attach images/PDFs/URLs.
2. **Backend API** (`src/app/api/chat/route.ts`) — a Next.js App Router route handler that scrapes URLs, parses PDFs, runs an agentic tool-calling loop, and streams Server-Sent Events back to the client.

### Chat Flow

```
User sends message + attachments
        │
        ▼
API Route (/api/chat) — stream opens immediately, progress events flow to the UI
        │
        ├── URLs (attached or inline in message text)
        │       → fetch + cheerio, Firecrawl fallback for JS-rendered pages
        │       → added as system context
        ├── Image attachments → passed to the vision model
        ├── PDF attachments → pdf-parse extracts text → added as system context
        │
        ▼
Agent loop (up to 4 rounds, OpenAI Responses API)
        │
        ├── Model calls web_search tool?
        │       → provider chain: Tavily (if key) → DuckDuckGo html → DuckDuckGo lite
        │       → top 6 results + extracted text of top 3 pages fed back
        │       → model continues (may search again)
        │
        ├── Model calls run_javascript tool?
        │       → code executed in a node:vm sandbox (5s timeout)
        │       → console.log output + last-statement value fed back
        │       → model continues (may iterate if the code errored)
        │
        ▼
Answer tokens streamed back as SSE, then follow-up suggestions
```

### Attachment & Context Processing

| Source | Processing |
|--------|------------|
| **URL** (inline or attached) | Fetched with `fetch()` (10s timeout), parsed with `cheerio` (scripts/styles removed, body text extracted, truncated to 10,000 chars). Falls back to Firecrawl for JS-rendered or anti-bot pages. |
| **Image** | Passed as `input_image` base64 content parts to `gpt-4o`. |
| **PDF** | Decoded from base64, parsed with `pdf-parse` (text up to 10,000 chars). |
| **Web search** | Provider chain (see above); result pages fetched and truncated to 3,000 chars each. |
| **JavaScript** | `run_javascript` tool calls execute in a fresh `node:vm` V8 context. The only host API is a capturing `console` — no `process`, `require`, `fetch`, timers, or DOM. Caps: 5s execution timeout, 20k chars of code, 10k chars of output. The model receives `console.log` output plus the value of the last statement. |

### Progress Events

Every long-running step emits an SSE status event the client renders as an activity feed:

- `visiting` / `visited` (per URL, with success flag)
- `reading_pdf` / `read_pdf`
- `searching` / `searched` (with success flag)
- `running_code` / `ran_code` (with success flag)
- `thinking`

The feed clears once the answer's first tokens start streaming.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack), React 19
- **AI:** OpenAI Responses API (`gpt-4o`) with function calling (`previous_response_id` continuation), optional fallback API key
- **Web search:** Tavily (optional) + DuckDuckGo keyless endpoints
- **Web scraping:** `cheerio`, `@mendable/firecrawl-js` (optional fallback)
- **PDF:** `pdf-parse` v2, `@napi-rs/canvas` (canvas API polyfill)
- **UI:** shadcn/ui (Base UI primitives), `lucide-react` (icons), `react-markdown` (rendering)
- **Styling:** Tailwind CSS v4 design tokens, dark/light themes

## Setup

```bash
cp .env.example .env
# Add your OPENAI_API_KEY

npm install
npm run dev
```

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes | Primary OpenAI API key |
| `OPENAI_FALLBACK_API_KEY` | No | Used automatically if the primary key fails (429/5xx/401) |
| `FIRECRAWL_API_KEY` | No | Scraping fallback for JS-rendered / anti-bot pages ([firecrawl.dev](https://firecrawl.dev)) |
| `TAVILY_API_KEY` | No | Recommended for serverless deploys: DuckDuckGo's keyless endpoints often block datacenter IPs; Tavily ([tavily.com](https://tavily.com), free tier, no credit card) does not |

## Deployment

Deploy to Vercel normally. Set `OPENAI_API_KEY` (and optionally the others above) in the Vercel project settings. The `next.config.ts` includes the necessary `serverExternalPackages` and `outputFileTracingIncludes` for PDF support.

## Known Limitations

- **DuckDuckGo endpoints are unofficial** and may rate-limit or block datacenter IPs — configure `TAVILY_API_KEY` for reliable search in production
- **PDF text extraction only** (no images/tables from PDFs)
- Agent tool loop is capped at 4 rounds per message
- The `run_javascript` sandbox is a compute sandbox, not a hard security boundary — it blocks accidental damage and runaway loops, but `node:vm` contexts are not designed to contain hostile code. This is acceptable because the code comes from the app's own model, not from third parties
