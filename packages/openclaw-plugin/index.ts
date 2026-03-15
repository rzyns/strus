/** Strus OpenClaw plugin entry point. */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createApiClient } from "./src/api-client.js";
import { registerCommands } from "./src/commands.js";
import { registerTools } from "./src/tools.js";
import { createNotifierService } from "./src/notifier.js";
import type { GeneratorConfig } from "./src/question-generator.js";

/**
 * Build a GeneratorConfig from environment variables.
 * Returns undefined if disabled or no API key is configured.
 *
 * Env vars:
 *   STRUS_QUESTION_GEN_ENABLED       — "false" to disable (default: enabled if key present)
 *   GEMINI_API_KEY                   — API key for gemini provider
 *   STRUS_QUESTION_GEN_API_KEY       — overrides GEMINI_API_KEY; use for openai-compat key
 *   STRUS_QUESTION_GEN_PROVIDER      — "gemini" | "openai-compat" (default: "gemini")
 *   STRUS_QUESTION_GEN_MODEL         — model override (default: "gemini-2.0-flash")
 *   STRUS_QUESTION_GEN_BASE_URL      — base URL for openai-compat
 *   STRUS_QUESTION_GEN_TIMEOUT_MS    — timeout in ms (default: 5000)
 */
function buildGeneratorConfig(): GeneratorConfig | undefined {
  if (process.env.STRUS_QUESTION_GEN_ENABLED === "false") return undefined;
  const apiKey = process.env.STRUS_QUESTION_GEN_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  return {
    provider: (process.env.STRUS_QUESTION_GEN_PROVIDER ?? "gemini") as "gemini" | "openai-compat",
    apiKey,
    model: process.env.STRUS_QUESTION_GEN_MODEL,
    baseUrl: process.env.STRUS_QUESTION_GEN_BASE_URL,
    timeoutMs: process.env.STRUS_QUESTION_GEN_TIMEOUT_MS
      ? parseInt(process.env.STRUS_QUESTION_GEN_TIMEOUT_MS, 10)
      : undefined,
  };
}

export default function strusPlugin(api: OpenClawPluginApi): void {
  const apiUrl = (api.pluginConfig?.apiUrl as string | undefined) ?? "http://localhost:3457";
  const client = createApiClient(apiUrl);
  const generatorConfig = buildGeneratorConfig();

  api.logger.info(`[strus] Plugin loaded (API: ${apiUrl})`);
  if (generatorConfig) {
    api.logger.info(`[strus] Question generator enabled (provider: ${generatorConfig.provider})`);
  }

  // Register slash commands: /strus and /s
  registerCommands(api, client);

  // Register agent tools (with optional question generator config)
  registerTools(api, client, generatorConfig);

  // Register background notifier service
  api.registerService(createNotifierService(client, api.pluginConfig));
}
