export async function register() {
  // No-op outside the nodejs runtime or without an OTLP endpoint —
  // telemetry stays env-driven so local dev needs no collector.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    // Dynamic import is deliberate: the OTel SDK must not load (or be bundled
    // for other runtimes) unless telemetry is actually enabled.
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({ serviceName: "marketflow" });
  }
}
