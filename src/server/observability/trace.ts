import "server-only";
import { trace as otelTrace, SpanStatusCode } from "@opentelemetry/api";

// No provider registered (no OTEL_EXPORTER_OTLP_ENDPOINT, unit tests) → the
// global tracer is a no-op, so wrapping is free in dev/test.
const tracer = otelTrace.getTracer("marketflow");

/**
 * Wraps `fn` in an OTel span named `name`. Works for sync and async
 * functions: sync results pass through (the span still records duration and
 * thrown exceptions), async results close the span on settle.
 */
export function trace<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A): R =>
    tracer.startActiveSpan(name, (span) => {
      try {
        const result = fn(...args);
        if (result instanceof Promise) {
          return result.finally(() => span.end()) as R;
        }
        span.end();
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        throw err;
      }
    });
}
