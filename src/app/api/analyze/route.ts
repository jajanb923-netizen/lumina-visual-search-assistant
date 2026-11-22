import { NextResponse } from "next/server";
import { chatVision, extractJson, salvageAnalysis } from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 60;

export interface Analysis {
  description: string;
  objects: string[];
  colors: string[];
  mood: string;
  altText: string;
  tags: string[];
}

const SYSTEM_PROMPT = `You are Lumina, an accessibility-first visual assistant. You describe
photos for people who cannot see them. Be concrete, honest and vivid.
Never invent objects that are not visible. If something is unclear, say so.
Always reply with a single JSON object and nothing else.`;

const USER_PROMPT = `Describe this photo for a blind person. Reply ONLY as JSON with exactly
these keys:
{
  "description": "2-3 clear sentences: what the photo shows, the setting, and the overall feeling.",
  "objects": ["up to 8 main visible objects or people, most prominent first"],
  "colors": ["up to 5 dominant colours"],
  "mood": "one or two words for the mood, e.g. calm, joyful, dramatic",
  "altText": "one concise sentence suitable as HTML alt text (max 125 characters)",
  "tags": ["up to 6 short search tags"]
}`;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB data-URL payload

function isDataUrlImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(jpeg|png|webp|gif);base64,/.test(value) &&
    value.length <= MAX_IMAGE_BYTES
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const imageDataUrl = (body as { imageDataUrl?: unknown })?.imageDataUrl;
  if (!isDataUrlImage(imageDataUrl)) {
    return NextResponse.json(
      { error: "imageDataUrl must be a JPEG/PNG/WebP/GIF data URL under 8 MB." },
      { status: 400 },
    );
  }

  try {
    const result = await chatVision(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: USER_PROMPT },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      1200,
    );

    const parsed = extractJson<Analysis>(result.text);
    if (!parsed || !parsed.description) {
      // The model answered with malformed/truncated JSON (common with
      // reasoning models): salvage the fields one by one instead of
      // showing raw JSON to the user.
      const salvaged = salvageAnalysis(result.text);
      if (salvaged.description) {
        const analysis: Analysis = {
          description: salvaged.description.slice(0, 1200),
          objects: salvaged.objects.slice(0, 8),
          colors: salvaged.colors.slice(0, 5),
          mood: salvaged.mood ?? "",
          altText: (salvaged.altText ?? salvaged.description).slice(0, 125),
          tags: salvaged.tags.slice(0, 6),
        };
        return NextResponse.json({
          analysis,
          model: result.model,
          attempts: result.attempts,
          totalLatencyMs: result.totalLatencyMs,
          jsonParsed: false,
          salvaged: true,
        });
      }
      // Last resort: plain prose (strip any JSON-looking wrapper first).
      const cleaned = result.text
        .replace(/```(?:json)?/g, "")
        .replace(/^\s*\{\s*"description"\s*:\s*"/, "")
        .replace(/"\s*\}\s*$/, "")
        .trim()
        .slice(0, 1200);
      const analysis: Analysis = {
        description: cleaned,
        objects: [],
        colors: [],
        mood: "",
        altText: cleaned.slice(0, 125),
        tags: [],
      };
      return NextResponse.json({
        analysis,
        model: result.model,
        attempts: result.attempts,
        totalLatencyMs: result.totalLatencyMs,
        jsonParsed: false,
      });
    }

    const analysis: Analysis = {
      description: String(parsed.description ?? "").slice(0, 1200),
      objects: Array.isArray(parsed.objects) ? parsed.objects.map(String).slice(0, 8) : [],
      colors: Array.isArray(parsed.colors) ? parsed.colors.map(String).slice(0, 5) : [],
      mood: String(parsed.mood ?? ""),
      altText: String(parsed.altText ?? "").slice(0, 125),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 6) : [],
    };
    return NextResponse.json({
      analysis,
      model: result.model,
      attempts: result.attempts,
      totalLatencyMs: result.totalLatencyMs,
      jsonParsed: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vision request failed.";
    const status = message.includes("OPENROUTER_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
