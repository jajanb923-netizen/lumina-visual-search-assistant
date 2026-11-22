import { NextResponse } from "next/server";
import { chatVision } from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Lumina, an accessibility-first visual assistant. Answer questions
about the photo the user is looking at. Be concrete and honest: if the
answer is not visible in the photo, say so instead of guessing. Keep
answers short (1-3 sentences) unless the user asks for detail. Never
invent objects, people, text or numbers that are not visible.`;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function isDataUrlImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(jpeg|png|webp|gif);base64,/.test(value) &&
    value.length <= MAX_IMAGE_BYTES
  );
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const { imageDataUrl, question, history } = body as {
    imageDataUrl?: unknown;
    question?: unknown;
    history?: unknown;
  };
  if (!isDataUrlImage(imageDataUrl)) {
    return NextResponse.json(
      { error: "imageDataUrl must be a JPEG/PNG/WebP/GIF data URL under 8 MB." },
      { status: 400 },
    );
  }
  if (typeof question !== "string" || !question.trim() || question.length > 500) {
    return NextResponse.json(
      { error: "question must be a non-empty string under 500 characters." },
      { status: 400 },
    );
  }
  const turns: ChatTurn[] = Array.isArray(history)
    ? (history as ChatTurn[])
        .filter(
          (t) =>
            t &&
            (t.role === "user" || t.role === "assistant") &&
            typeof t.content === "string",
        )
        .slice(-8)
    : [];

  const messages: Parameters<typeof chatVision>[0] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...turns.map((t) => ({ role: t.role, content: t.content })),
    {
      role: "user",
      content: [
        { type: "text", text: question.trim() },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];

  try {
    const result = await chatVision(messages, 600);
    return NextResponse.json({
      answer: result.text.trim(),
      model: result.model,
      attempts: result.attempts,
      totalLatencyMs: result.totalLatencyMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vision request failed.";
    const status = message.includes("OPENROUTER_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
