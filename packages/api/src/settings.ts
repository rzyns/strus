import { db } from "@strus/db";
import { settings } from "@strus/db";
import { eq } from "drizzle-orm";

export const SETTINGS_KEYS = {
  IMAGE_PROMPT_TEMPLATE: "imagePromptTemplate",
} as const;

export const DEFAULTS: Record<string, string> = {
  [SETTINGS_KEYS.IMAGE_PROMPT_TEMPLATE]: `Write a vivid, specific image generation prompt to help a Polish language learner remember the word "{{word}}" ({{wordClass}}{{#gender}}, {{gender}}{{/gender}}{{#meaning}}, meaning "{{meaning}}"{{/meaning}}).

The image must be RETRIEVABLE: a learner who sees it days later should be able to reconstruct the word's meaning without any other context.

Core rule: the word's meaning is the unmistakable subject of the scene. Absurdity, exaggeration, and humor are welcome — but they must amplify the meaning, not obscure it.

Retrievability test: a person unfamiliar with Polish should look at the image and correctly guess what the word means.

Optional — keyword method: if the word (or part of it) sounds like a recognizable word in English or another language, you may build that sound-alike into the scene alongside the meaning. The sound-alike is a secondary hook; the meaning remains the primary anchor.

Anti-pattern to avoid: a scene that metaphorically enacts the concept without the concept itself being visually obvious. Avoid clever indirection that requires the viewer to decode a metaphor.

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
  const updatedAt = new Date();
  db.insert(settings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
    .run();
}
