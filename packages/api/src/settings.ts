import { db } from "@strus/db";
import { settings } from "@strus/db";
import { eq } from "drizzle-orm";

export const SETTINGS_KEYS = {
  IMAGE_PROMPT_TEMPLATE: "imagePromptTemplate",
} as const;

export const DEFAULTS: Record<string, string> = {
  [SETTINGS_KEYS.IMAGE_PROMPT_TEMPLATE]: `Write a vivid, specific image generation prompt to help a Polish language learner remember the word "{{word}}" ({{wordClass}}{{#gender}}, {{gender}}{{/gender}}).

The prompt should describe a single concrete, memorable scene using wordplay, visual metaphor, or absurdist imagery tied to the word's meaning or sound. Be creative and specific — not generic.

Requirements for the image prompt you write:
- No text, letters, numbers, symbols, or writing of any kind in the image
- Photorealistic style
- One clear focal scene, not a collage

Respond with only the image prompt text, nothing else.`,
};

export function getSetting(key: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? DEFAULTS[key] ?? "";
}

export function setSetting(key: string, value: string): void {
  const updatedAt = new Date().toISOString();
  db.insert(settings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
    .run();
}
