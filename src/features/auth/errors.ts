// Client-safe: maps server action error/issue codes to `auth.*` message keys.
const TOP_LEVEL: Record<string, string> = {
  EMAIL_TAKEN: "emailTaken",
  INVALID_CREDENTIALS: "invalidCredentials",
  INVALID_INPUT: "invalidInput",
  INVALID_TOKEN: "invalidToken",
  RATE_LIMITED: "rateLimited",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
};

const FIELD: Record<string, string> = {
  too_small: "fieldTooSmall",
  too_big: "fieldTooBig",
  invalid_format: "fieldInvalidEmail",
  invalid_type: "fieldInvalid",
};

export const errorKey = (code: string): string => TOP_LEVEL[code] ?? "invalidInput";
export const fieldKey = (code: string): string => FIELD[code] ?? "fieldInvalid";
