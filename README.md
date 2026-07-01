# Aura RAG - Multi-modal Assistant

An intelligent RAG (Retrieval-Augmented Generation) web application built with Next.js 16. It uses Groq's high-speed inference for both LLM (text) and Vision models, with support for web scraping and PDF parsing as context sources.

## How It Works

### Architecture

The app has two main parts:

1. **Frontend** (`src/app/page.tsx`) — A chat interface with glassmorphism styling. Users can type text, attach images/PDFs, or provide URLs.
2. **Backend API** (`src/app/api/chat/route.ts`) — A Next.js App Router route handler that processes attachments, scrapes URLs, parses PDFs, and calls Groq's API.

### Chat Flow

```
User sends message + attachments
        │
        ▼
API Route (/api/chat)
        │
        ├── URL attachments → cheerio scrapes page text → added as system context
        ├── Image attachments → passed directly to Groq Vision model
        ├── PDF attachments → pdfjs-dist extracts text → added as system context
        │
        ▼
Groq LLM API (llama-3.3-70b-versatile for text, llama-4-scout-17b for images)
        │
        ▼
Response streamed back as JSON
```

### Attachment Processing

| Type | Backend Processing |
|------|--------------------|
| **URL** | Fetched with `fetch()`, parsed with `cheerio` (scripts/styles removed, body text extracted, truncated to 5000 chars). |
| **Image** | Passed as `image_url` base64 to Groq's Vision-capable model (`meta-llama/llama-4-scout-17b-16e-instruct`). |
| **PDF** | Decoded from base64, parsed with `pdfjs-dist` / `pdf-parse`, text extracted (up to 10000 chars). |

### Attachments in Chat

The UI (page.tsx) manages attachments in local state before sending. Multiple attachment types can be sent in a single message. The attachment toolbar includes:
- **Link icon** — opens an inline URL input popover
- **Image icon** — opens a file picker (accepts `image/*` and `application/pdf`)
- Attached items appear as chips below the input with a remove button

### Context Assembly

The API route builds a system prompt from scratch per-request:
1. If any URLs or PDFs are attached, their extracted text is injected as:
   > You are Aura, an intelligent AI RAG assistant. You have been provided with the following scraped webpage context...
2. Otherwise a generic system prompt is used.
3. Previous conversation history is preserved and sent alongside the last message.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **AI:** Groq SDK (`groq-sdk`) — `llama-3.3-70b-versatile`, `meta-llama/llama-4-scout-17b-16e-instruct`
- **PDF:** `pdf-parse` v2, `pdfjs-dist` v5, `@napi-rs/canvas`
- **Web Scraping:** `cheerio`
- **UI:** React 19, `lucide-react` (icons), `react-markdown` (rendering)
- **Styling:** CSS custom properties, glassmorphism design

## Known Limitations

- **Vercel Serverless:** The `@napi-rs/canvas` native module requires `serverExternalPackages` config. The `pdfjs-dist` worker file must be explicitly included via `outputFileTracingIncludes` so it's available on the serverless runtime.
- **PDF text extraction only (no images/tables from PDFs)**
- **Groq API required** — set `GROQ_API_KEY` in environment variables

## Setup

```bash
cp .env.example .env.local
# Add your GROQ_API_KEY

npm install
npm run dev
```

## Deployment

Deploy to Vercel normally. Ensure the `GROQ_API_KEY` environment variable is set in the Vercel project settings. The `next.config.ts` includes the necessary `serverExternalPackages` and `outputFileTracingIncludes` for PDF support.
