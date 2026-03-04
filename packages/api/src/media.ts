import { mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { MorphGender } from "@strus/morph";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getMediaDir(): string {
  return process.env.STRUS_MEDIA_DIR || resolve(process.cwd(), "media");
}

export function getMediaBaseUrl(): string {
  if (process.env.STRUS_MEDIA_BASE_URL) {
    return process.env.STRUS_MEDIA_BASE_URL;
  }
  // Derive from STRUS_API_URL if set, so changing the API base URL is enough
  // to fix media URLs without needing to also set STRUS_MEDIA_BASE_URL.
  const apiBase =
    process.env.STRUS_API_URL ||
    `http://localhost:${process.env.PORT || "3457"}`;
  return `${apiBase.replace(/\/$/, "")}/media`;
}

// ---------------------------------------------------------------------------
// Voice selection
// ---------------------------------------------------------------------------

const VOICES = {
  m: "CLuTGacrAhcIhaJslbXt", // Rafał — masculine
  f: "H3IcxEgdFxIEJAqMc0Bc", // Joanna v2 — feminine
  n: "ee2pDOfqzj2pBerZvUCH", // Rocco — neuter (robotic/genderless)
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitize a string for use as a filename — replace colons and dots with hyphens. */
function sanitize(s: string): string {
  return s.replace(/[:.]/g, "-");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// TTS generation (ElevenLabs)
// ---------------------------------------------------------------------------

/**
 * Generate TTS audio for a Polish word form.
 * Returns the relative path stored in DB, e.g. "audio/dom-subst-sg-nom-m3.mp3".
 * Returns null if ELEVENLABS_API_KEY is not set (graceful degradation).
 */
export async function generateAudio(
  orth: string,
  tag: string,
  gender: MorphGender,
): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  const voiceId = VOICES[gender ?? "m"];
  const filename = `${sanitize(orth)}-${sanitize(tag)}.mp3`;
  const relativePath = `audio/${filename}`;
  const absolutePath = join(getMediaDir(), relativePath);

  // Skip if already generated
  if (existsSync(absolutePath)) return relativePath;

  ensureDir(join(getMediaDir(), "audio"));

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: orth,
        model_id: "eleven_multilingual_v2",
      }),
    },
  );

  if (!response.ok) {
    console.warn(
      `[media] ElevenLabs TTS failed for "${orth}": ${response.status} ${response.statusText}`,
    );
    return null;
  }

  const buffer = await response.arrayBuffer();
  await Bun.write(absolutePath, buffer);
  return relativePath;
}

// ---------------------------------------------------------------------------
// Image generation (Gemini)
// ---------------------------------------------------------------------------

/**
 * Generate a mnemonic image for a Polish lemma.
 * Returns the relative path stored in DB, e.g. "images/dom.png".
 * Returns null if GEMINI_API_KEY is not set (graceful degradation).
 */
export async function generateImage(
  lemma: string,
  gloss?: string,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const filename = `${sanitize(lemma)}.png`;
  const relativePath = `images/${filename}`;
  const absolutePath = join(getMediaDir(), relativePath);

  // Skip if already generated
  if (existsSync(absolutePath)) return relativePath;

  ensureDir(join(getMediaDir(), "images"));

  const meaning = gloss || "a Polish word";
  const prompt =
    `A vivid, memorable mnemonic illustration for the Polish word '${lemma}' (meaning: ${meaning}). ` +
    `The image should be clear, striking, and easy to remember. ` +
    `Absolutely no text, letters, words, numbers, or writing anywhere in the image.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
    },
  );

  if (!response.ok) {
    console.warn(
      `[media] Gemini image generation failed for "${lemma}": ${response.status} ${response.statusText}`,
    );
    return null;
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType: string; data: string };
        }>;
      };
    }>;
  };

  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) {
    console.warn(`[media] Gemini returned no parts for "${lemma}"`);
    return null;
  }

  for (const part of parts) {
    if (part.inlineData) {
      const imageBytes = Buffer.from(part.inlineData.data, "base64");
      await Bun.write(absolutePath, imageBytes);
      return relativePath;
    }
  }

  console.warn(`[media] Gemini returned no image data for "${lemma}"`);
  return null;
}
