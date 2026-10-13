import "server-only";
import pino from "pino";

const options: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  // Never log credentials, tokens, session material, or auth headers.
  // pino `*` matches ONE path segment — cover bare, one-deep, and
  // req.headers-style two-deep nests for cookie/authorization.
  redact: {
    paths: [
      "password",
      "*.password",
      "passwordHash",
      "*.passwordHash",
      "token",
      "*.token",
      "secret",
      "*.secret",
      "session",
      "*.session",
      "cookie",
      "*.cookie",
      "*.*.cookie",
      "authorization",
      "*.authorization",
      "*.*.authorization",
    ],
    censor: "[redacted]",
  },
  base: { service: "marketflow", env: process.env.APP_ENV ?? "development" },
};

/** Exported for tests: pass a writable stream to capture output. */
export function createLogger(stream?: pino.DestinationStream) {
  return stream ? pino(options, stream) : pino(options);
}

export const logger = createLogger();

/** Per-request child logger; call sites may add trace ids as they land. */
export function getRequestLogger(requestId: string) {
  return logger.child({ requestId });
}
