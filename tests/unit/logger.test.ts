import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, logger } from "@/server/observability/logger";

function capture() {
  let out = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  return { stream, read: () => out };
}

describe("logger", () => {
  it("redacts credentials, tokens, and auth headers", () => {
    const { stream, read } = capture();
    const log = createLogger(stream);
    log.info({
      password: "hunter2",
      nested: { token: "abc" },
      headers: { cookie: "s=x", authorization: "Bearer y" },
    });
    const line = JSON.parse(read());
    expect(line.password).toBe("[redacted]");
    expect(line.nested.token).toBe("[redacted]");
    expect(line.headers.cookie).toBe("[redacted]");
    expect(line.headers.authorization).toBe("[redacted]");
  });

  it("includes service base fields and requestId via child logger", () => {
    const { stream, read } = capture();
    createLogger(stream).child({ requestId: "req-1" }).info("hi");
    const line = JSON.parse(read());
    expect(line.service).toBe("marketflow");
    expect(line.requestId).toBe("req-1");
    expect(line.msg).toBe("hi");
  });

  it("default logger honors LOG_LEVEL default of info", () => {
    expect(logger.level).toBe("info");
  });
});
