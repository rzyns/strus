/** Background service: due-card notifier. Polls stats and logs due count. */

import type { OpenClawPluginService, OpenClawPluginServiceContext } from "openclaw/plugin-sdk";
import type { StrusApiClient } from "./api-client.js";

export function createNotifierService(
  client: StrusApiClient,
  pluginConfig?: Record<string, unknown>,
): OpenClawPluginService {
  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    id: "strus-notifier",

    start(ctx: OpenClawPluginServiceContext) {
      const intervalMinutes =
        (pluginConfig?.notifyIntervalMinutes as number | undefined) ?? 60;
      const intervalMs = intervalMinutes * 60 * 1000;

      ctx.logger.info(
        `[strus-notifier] Starting due-card notifier (interval: ${intervalMinutes}min)`,
      );

      async function tick() {
        try {
          const stats = await client.getStats();
          if (stats.dueCount > 0) {
            ctx.logger.info(
              `[strus-notifier] ${stats.dueCount} cards due (${stats.lemmaCount} lemmas, ${stats.listCount} lists)`,
            );
            // TODO: Send notification to Discord channel via api.runtime or Discord REST API.
            // Currently just logs. To enable notifications, set pluginConfig.notifyChannel
            // and implement Discord message sending here.
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.error(`[strus-notifier] Failed to fetch stats: ${msg}`);
        }
      }

      // Initial tick
      tick();
      timer = setInterval(tick, intervalMs);
    },

    stop(ctx: OpenClawPluginServiceContext) {
      ctx.logger.info("[strus-notifier] Stopping due-card notifier");
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
