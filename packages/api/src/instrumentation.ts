/**
 * OpenTelemetry setup for strus-api.
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP HTTP base URL (e.g. http://localhost:4318)
 *                                    Default: disabled (no spans exported)
 *   OTEL_CONSOLE_TRACES=true      — Also print spans to stdout (useful for dev without a collector)
 *   OTEL_SERVICE_NAME             — Service name tag on all spans (default: "strus-api")
 *
 * Usage:
 *   1. Import and .use() otelPlugin BEFORE other Elysia plugins in index.ts
 *   2. Use record() and setAttributes() from @elysiajs/opentelemetry at call sites
 *   3. Run docker compose -f docker-compose.otel.yaml up for local Jaeger UI
 */

import { opentelemetry } from "@elysiajs/opentelemetry";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

const serviceName = process.env.OTEL_SERVICE_NAME ?? "strus-api";

const processors = [];

// OTLP exporter — active when OTEL_EXPORTER_OTLP_ENDPOINT is set
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "");
  processors.push(
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    ),
  );
}

// Console exporter — active when OTEL_CONSOLE_TRACES=true
if (process.env.OTEL_CONSOLE_TRACES === "true") {
  processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
}

/**
 * The Elysia OTel plugin. Apply with `.use(otelPlugin)` as the FIRST plugin
 * in your Elysia app — before routes, other plugins, etc.
 *
 * When no exporters are configured, the plugin is a no-op (zero overhead).
 */
export const otelPlugin = opentelemetry({
  serviceName,
  spanProcessors: processors,
});
