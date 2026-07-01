import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "", // Ensure you have GROQ_API_KEY in your .env
});

type Attachment = {
  type: "image" | "url" | "pdf";
  data: string;
};

type Message = {
  role: "user" | "assistant" | "system";
  content: string | any[];
};

export async function POST(req: Request) {
  try {
    const { messages, attachments = [] } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Invalid messages format" }, { status: 400 });
    }

    // Scrape URLs if any
    let scrapedContext = "";
    const urls = attachments.filter((att: Attachment) => att.type === "url").map((att: Attachment) => att.data);
    
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const html = await res.text();
          const $ = cheerio.load(html);
          // Remove scripts and styles
          $('script, style').remove();
          const text = $('body').text().replace(/\s+/g, ' ').trim();
          scrapedContext += `\n\n--- Content from ${url} ---\n${text.substring(0, 5000)}\n--- End Content ---\n`;
        }
      } catch (err) {
        console.error("Error scraping URL:", url, err);
        scrapedContext += `\n\n--- Error scraping ${url} ---\n`;
      }
    }

    const images = attachments.filter((att: Attachment) => att.type === "image");
    const pdfs = attachments.filter((att: Attachment) => att.type === "pdf");
    
    for (const pdf of pdfs) {
      try {
        const base64Data = pdf.data.split(",")[1];
        if (base64Data) {
          const buffer = Buffer.from(base64Data, "base64");
          const parser = new PDFParse({ data: buffer });
          const pdfData = await parser.getText();
          await parser.destroy();
          scrapedContext += `\n\n--- Content from PDF ---\n${pdfData.text.substring(0, 10000)}\n--- End Content ---\n`;
        }
      } catch (err) {
        console.error("Error parsing PDF:", err);
        scrapedContext += `\n\n--- Error reading PDF ---\n`;
      }
    }
    
    // Prepare Groq messages
    let formattedMessages: Message[] = [];
    
    // Add system message if there is scraped context
    if (scrapedContext) {
      formattedMessages.push({
        role: "system",
        content: `You are Aura, an intelligent AI RAG assistant. You have been provided with the following scraped webpage context. Use it to answer the user's queries if relevant.\n${scrapedContext}`
      });
    } else {
      formattedMessages.push({
        role: "system",
        content: `You are Aura, an intelligent AI assistant. Be helpful, concise, and friendly.`
      });
    }

    const lastMessage = messages[messages.length - 1];
    const previousMessages = messages.slice(0, -1);

    // Add previous messages (text only)
    for (const msg of previousMessages) {
      formattedMessages.push({
        role: msg.role,
        content: msg.content
      });
    }

    // Handle last message which may include images
    if (images.length > 0) {
      const contentArray: any[] = [
        { type: "text", text: lastMessage.content || "Please analyze this image." }
      ];
      
      for (const img of images) {
        contentArray.push({
          type: "image_url",
          image_url: {
            url: img.data // Base64 URL
          }
        });
      }

      formattedMessages.push({
        role: lastMessage.role,
        content: contentArray
      });
    } else {
      formattedMessages.push({
        role: lastMessage.role,
        content: lastMessage.content
      });
    }

    // meta-llama/llama-4-scout-17b-16e-instruct for images
    // llama-3.3-70b-versatile for text
    const model = images.length > 0 ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.3-70b-versatile";

    const completion = await groq.chat.completions.create({
      messages: formattedMessages,
      model: model,
      temperature: 0.5,
      max_tokens: 2048,
    });

    const reply = completion.choices[0]?.message?.content || "No response generated.";

    return NextResponse.json({ reply });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "Something went wrong" }, { status: 500 });
  }
}
