import "server-only";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "EMAIL_TAKEN"
  | "INVALID_CREDENTIALS"
  | "INVALID_INPUT"
  | "INVALID_TOKEN"
  | "RATE_LIMITED";

export class AuthError extends Error {
  constructor(
    public code: ErrorCode,
    public status = 400,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

/** Serializes thrown errors for route handlers: `{ error: { code, message } }` + status. */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    return Response.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  // Unknown failure — never leak internals.
  return Response.json({ error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
}
