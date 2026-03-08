import { mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import Mustache from "mustache";
import { record, setAttributes } from "@elysiajs/opentelemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import type { MorphGender } from "@rzyns/strus-morph";
import { tagWordClass, tagGenderLabel } from "@rzyns/strus-morph";
import { getSetting, SETTINGS_KEYS } from "./settings.js";

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

  return record("elevenlabs.tts", async (span) => {
    const voiceId = VOICES[gender ?? "m"];
    const filename = `${sanitize(orth)}-${sanitize(tag)}.mp3`;
    const relativePath = `audio/${filename}`;
    const absolutePath = join(getMediaDir(), relativePath);

    span.setAttributes({
      "tts.orth": orth,
      "tts.tag": tag,
      "tts.gender": gender ?? "m",
      "tts.voice_id": voiceId,
      "tts.cached": existsSync(absolutePath),
    });

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

    span.setAttribute("http.status_code", response.status);

    if (!response.ok) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `ElevenLabs ${response.status}` });
      const errorBody = await response.text().catch(() => '<unreadable>');
      console.warn(
        `[media] ElevenLabs TTS failed for "${orth}": ${response.status} — ${errorBody}`,
      );
      return null;
    }

    const buffer = await response.arrayBuffer();
    span.setAttribute("tts.bytes", buffer.byteLength);
    await Bun.write(absolutePath, buffer);
    return relativePath;
  }) as Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Image generation (Gemini)
// ---------------------------------------------------------------------------

/**
 * Render the meta-prompt template — what gets sent to the Gemini text model
 * to generate a word-specific image prompt.
 *
 * @param meaning - Optional translation/gloss (e.g. "rejection"). When provided,
 *   it is exposed as `{{meaning}}` in the template so the model can produce
 *   more semantically grounded mnemonic images.
 */
export function renderMetaPrompt(lemma: string, tag: string, meaning?: string | null): string {
  const template = getSetting(SETTINGS_KEYS.IMAGE_PROMPT_TEMPLATE);
  return Mustache.render(template, {
    word: lemma,
    wordClass: tagWordClass(tag),
    gender: tagGenderLabel(tag),
    meaning: meaning ?? null,
  });
}

/**
 * Generate a mnemonic image for a Polish lemma using a two-stage pipeline:
 * 1. Gemini text model generates a specific image prompt from the meta-prompt template
 * 2. Gemini image model generates an image from that specific prompt
 *
 * Returns both the relative path and the generated image prompt for DB storage.
 * Returns nulls if GEMINI_API_KEY is not set (graceful degradation).
 * Always overwrites — caller decides whether to regenerate.
 *
 * @param meaning - Optional translation/gloss forwarded to `renderMetaPrompt`.
 */
export async function generateImage(
  lemma: string,
  tag: string,
  meaning?: string | null,
): Promise<{ relativePath: string | null; imagePrompt: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { relativePath: null, imagePrompt: null };

  return record("gemini.image.generate", async (span) => {
    span.setAttributes({
      "gemini.lemma": lemma,
      "gemini.tag": tag,
    });

    // Stage 1 — generate specific image prompt via Gemini text model
    const metaPrompt = renderMetaPrompt(lemma, tag, meaning);
    const textModel = process.env.STRUS_GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";

    const specificPrompt = await record("gemini.text.generateContent", async (textSpan) => {
      textSpan.setAttribute("gemini.model", textModel);

      const textResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${textModel}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: metaPrompt }] }],
          }),
        },
      );

      textSpan.setAttribute("http.status_code", textResponse.status);

      if (!textResponse.ok) {
        textSpan.setStatus({ code: SpanStatusCode.ERROR, message: `Gemini text ${textResponse.status}` });
        const errorBody = await textResponse.text().catch(() => '<unreadable>');
        console.warn(`[media] Gemini text generation failed: ${textResponse.status} — ${errorBody}`);
        return null;
      }

      const textData = (await textResponse.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const prompt =
        textData.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text?.trim() ?? null;

      if (!prompt) {
        textSpan.setStatus({ code: SpanStatusCode.ERROR, message: "No prompt generated" });
        console.warn(`[media] Gemini text returned no prompt for "${lemma}"`);
      }

      return prompt;
    }) as string | null;

    if (!specificPrompt) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "No specific prompt from text model" });
      return { relativePath: null, imagePrompt: null };
    }

    span.setAttribute("gemini.image_prompt_length", specificPrompt.length);

    // Stage 2 — generate image using the specific prompt
    const filename = `${sanitize(lemma)}.png`;
    const relativePath = `images/${filename}`;
    const absolutePath = join(getMediaDir(), relativePath);
    ensureDir(join(getMediaDir(), "images"));

    const imageModel = process.env.STRUS_GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";

    const result = await record("gemini.image.generateContent", async (imgSpan) => {
      imgSpan.setAttribute("gemini.model", imageModel);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: specificPrompt }] }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
            },
          }),
        },
      );

      imgSpan.setAttribute("http.status_code", response.status);

      if (!response.ok) {
        imgSpan.setStatus({ code: SpanStatusCode.ERROR, message: `Gemini image ${response.status}` });
        const errorBody = await response.text().catch(() => '<unreadable>');
        console.warn(
          `[media] Gemini image generation failed for "${lemma}": ${response.status} — ${errorBody}`,
        );
        return { relativePath: null, imagePrompt: specificPrompt };
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
        imgSpan.setStatus({ code: SpanStatusCode.ERROR, message: "No parts in response" });
        console.warn(`[media] Gemini returned no parts for "${lemma}"`);
        return { relativePath: null, imagePrompt: specificPrompt };
      }

      for (const part of parts) {
        if (part.inlineData) {
          const imageBytes = Buffer.from(part.inlineData.data, "base64");
          imgSpan.setAttribute("gemini.image_bytes", imageBytes.byteLength);
          await Bun.write(absolutePath, imageBytes);
          return { relativePath, imagePrompt: specificPrompt };
        }
      }

      imgSpan.setStatus({ code: SpanStatusCode.ERROR, message: "No image data in response" });
      console.warn(`[media] Gemini returned no image data for "${lemma}"`);
      return { relativePath: null, imagePrompt: specificPrompt };
    }) as { relativePath: string | null; imagePrompt: string | null };

    return result;
  }) as Promise<{ relativePath: string | null; imagePrompt: string | null }>;
}
