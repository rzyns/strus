/**
 * Browser-side OpenTelemetry setup for strus-web.
 *
 * What this does:
 *   - Creates a WebTracerProvider with the strus-web service name
 *   - Registers fetch() auto-instrumentation so every API call creates a span
 *     and injects a W3C `traceparent` header into the request
 *   - The server reads that header and nests its spans under the browser span,
 *     giving you a complete browser→server trace in Jaeger
 *
 * Environment variables (Vite, set in .env.local or docker):
 *   VITE_OTEL_OTLP_ENDPOINT   — OTLP HTTP base URL, e.g. /otlp (proxied) or
 *                                http://collector:4318. No tracing if unset.
 *   VITE_OTEL_SERVICE_NAME     — defaults to "strus-web"
 *
 * In development, Vite proxies /otlp → http://localhost:4318 so no CORS needed.
 * In production, point at your collector directly or via a reverse proxy.
 */

import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";

export function initTelemetry(): void {
  const otlpEndpoint = import.meta.env.VITE_OTEL_OTLP_ENDPOINT as string | undefined;
  if (!otlpEndpoint) return; // tracing disabled — zero overhead

  const serviceName =
    (import.meta.env.VITE_OTEL_SERVICE_NAME as string | undefined) ?? "strus-web";

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          // The endpoint must include /v1/traces (HTTP OTLP convention)
          url: `${otlpEndpoint.replace(/\/$/, "")}/v1/traces`,
        }),
      ),
    ],
  });

  // Register W3C Trace Context propagation — this is what injects `traceparent`
  // into outgoing fetch() calls and is what the server reads to link spans.
  provider.register({
    propagator: new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(), // traceparent + tracestate headers
        new W3CBaggagePropagator(),       // baggage header (optional but conventional)
      ],
    }),
  });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        // Inject traceparent into requests matching these patterns.
        // We use /.*/ to cover same-origin requests (Vite proxy handles /api, /rpc).
        // In production with CORS, restrict this to your API origin.
        propagateTraceHeaderCorsUrls: [/.*/],

        // Don't let instrumentation timing entries pile up in the browser
        clearTimingResources: true,

        // Give spans readable names based on method + URL path (strips query strings)
        applyCustomAttributesOnSpan(span, request, result) {
          if (request instanceof Request) {
            // Trim the origin so Jaeger shows "POST /rpc/session.review"
            // rather than the full "http://localhost:5173/rpc/session.review"
            try {
              const url = new URL(request.url);
              span.setAttribute("http.target", url.pathname);
              span.setAttribute("http.method", request.method);
            } catch {
              // non-parseable URL — leave as-is
            }
          }
          if (result instanceof Response) {
            span.setAttribute("http.status_code", result.status);
          }
        },
      }),
    ],
  });
}
