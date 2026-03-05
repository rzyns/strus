import { db } from "@strus/db";
import { settings } from "@strus/db";
import { eq, sql } from "drizzle-orm";

export const SETTINGS_KEYS = {
  IMAGE_PROMPT_TEMPLATE: "imagePromptTemplate",
} as const;

export const DEFAULTS: Record<string, string> = {
  [SETTINGS_KEYS.IMAGE_PROMPT_TEMPLATE]: `A vivid, dreamlike mnemonic scene for the Polish {{wordClass}} "{{word}}"{{#gender}} ({{gender}}){{/gender}}. The scene uses concrete imagery or wordplay to make the word unforgettable. Absolutely no text, letters, numbers, symbols, or writing of any kind anywhere in the image. Photorealistic style.`,
};

export function getSetting(key: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? DEFAULTS[key] ?? "";
}

export function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`(datetime("now"))` } })
    .run();
}
