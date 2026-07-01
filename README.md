# Aura RAG - Multi-modal Assistant

A intelligent web application built with Next.js, featuring a Retrieval-Augmented Generation (RAG) assistant. It uses Groq's high-speed inference for both LLM and Vision models. 

## Features
- 💬 **Chat Interface:** A beautiful, responsive glassmorphism design.
- 🖼️ **Vision Processing:** Upload images (handwritten or typed text) and the AI will analyze them using Groq's Llama-3 Vision model.
- 🔗 **Web Scraping RAG:** Attach URLs to your queries, and the backend will scrape the text content and inject it as context to answer your questions accurately.
- ⚡ **Vercel Ready:** Built on Next.js App Router, completely ready to be deployed on Vercel.

## Setup Instructions

1. **Install dependencies (if not already):**
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   Copy `.env.example` to `.env.local` and add your Groq API key:
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local`:
   ```
   GROQ_API_KEY=your_actual_api_key_here
   ```

3. **Run the Development Server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment to Vercel

This app is perfectly optimized for Vercel deployment:
1. Push your code to a GitHub repository.
2. Go to your [Vercel Dashboard](https://vercel.com/dashboard) and click "Add New Project".
3. Import your GitHub repository.
4. In the "Environment Variables" section, add:
   - Key: `GROQ_API_KEY`
   - Value: `<your_groq_api_key>`
5. Click "Deploy". Your app will be live with full Serverless API route support for the scraping and AI functionalities!
