import { db } from "@rzyns/strus-db";
import { settings } from "@rzyns/strus-db";
import { eq } from "drizzle-orm";

export const SETTINGS_KEYS = {
  IMAGE_PROMPT_TEMPLATE: "imagePromptTemplate",
} as const;

export const DEFAULTS: Record<string, string> = {
  [SETTINGS_KEYS.IMAGE_PROMPT_TEMPLATE]: `Write a vivid, specific image generation prompt to help a Polish language learner remember the word "{{word}}" ({{wordClass}}{{#gender}}, {{gender}}{{/gender}}{{#meaning}}, meaning "{{meaning}}"{{/meaning}}).

PURPOSE: The image is a mnemonic — a learner who sees it days later, without any caption, should immediately recall the word's meaning.

COMPOSITION — meaning first:
The word's meaning must be the dominant visual subject, occupying the largest portion of the frame.
- For verbs: show a person clearly performing the action as the central figure.
- For nouns: show the object/concept itself prominently, not a metaphor for it.
- For adjectives: show a person or object unmistakably exhibiting the quality.
Everything else in the scene — setting, props, background — exists to support and reinforce the meaning, not to compete with it.

SOUND-ALIKE HOOK (optional, use with care):
If the Polish word sounds like an English (or other language) word, you may include a visual reference to that sound-alike as a SMALL BACKGROUND DETAIL or environmental texture — a logo on a shirt, a poster on a wall, a shape in the clouds. It must NOT be the focal point, must NOT dominate the composition, and must NOT distract from the meaning. If the sound-alike would naturally overwhelm the scene (e.g. a famous landmark), shrink it to a minor element or skip it entirely.

SELF-TEST before finalizing: Imagine showing this image to someone with no context. Would they say "that's a person writing" (correct) or "that's the Leaning Tower of Pisa" (wrong)? The first thing a viewer notices must be the meaning.

ANTI-PATTERNS:
- A famous landmark or object dominating the scene while the meaning is abstract or tiny
- Clever metaphors that require decoding — the meaning should be literal and obvious
- The action/concept represented only by its effects rather than being shown directly

REQUIREMENTS:
- No text, letters, numbers, symbols, or writing of any kind in the image
- Photorealistic style
- One clear focal scene, not a collage
- Human figures should have natural proportions and be the right scale to be clearly visible

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
