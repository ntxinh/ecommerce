"use server";

import type { z } from "zod";
import {
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  ResetRequestInput,
} from "@/server/api/contracts/auth";
import { AuthError } from "@/server/api/errors";
import { getActor } from "@/server/auth/actor";
import { clearSessionCookie, getSessionToken, setSessionCookie } from "@/server/auth/cookies";
import { checkRateLimit } from "@/server/auth/rate-limit";
import { createSession, revokeSession } from "@/server/auth/sessions";
import { hashToken } from "@/server/auth/tokens";
import { getDb } from "@/server/db/client";
import {
  authenticate,
  createPasswordReset,
  register,
  resetPassword,
  sendVerification,
} from "@/server/modules/identity/service";

export type ActionResult =
  | { ok: true; redirect?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type ActionState = ActionResult | null;

/** Zod failure → code-shaped ActionResult; field errors carry issue codes the UI maps to messages. */
function fieldErrors(r: { success: false; error: z.ZodError }): ActionResult {
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= issue.code;
  }
  return { ok: false, error: "INVALID_INPUT", fieldErrors: fields };
}

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = RegisterInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed);

  try {
    const user = await register(getDb(), parsed.data);
    const session = await createSession(getDb(), user.id);
    await setSessionCookie(session.token);
    return { ok: true, redirect: "/" };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = LoginInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed);

  const email = parsed.data.email.trim().toLowerCase();
  if (!checkRateLimit(`login:${email}`, 5, 60)) return { ok: false, error: "RATE_LIMITED" };

  const user = await authenticate(getDb(), parsed.data);
  if (!user) return { ok: false, error: "INVALID_CREDENTIALS" };

  const session = await createSession(getDb(), user.id);
  await setSessionCookie(session.token);
  return { ok: true, redirect: "/" };
}
export async function logoutAction(_prev: ActionState, _formData: FormData): Promise<ActionResult> {
  const token = await getSessionToken();
  if (token) await revokeSession(getDb(), hashToken(token));
  await clearSessionCookie();
  return { ok: true, redirect: "/login" };
}

export async function requestResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = ResetRequestInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed);
  // Always ok — never reveal whether the email exists; rate-limit quietly caps issuance.
  const email = parsed.data.email.trim().toLowerCase();
  if (checkRateLimit(`reset:${email}`, 3, 3600)) {
    await createPasswordReset(getDb(), email);
  }
  return { ok: true };
}

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = ResetPasswordInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrors(parsed);

  const done = await resetPassword(getDb(), parsed.data.token, parsed.data.password);
  if (!done) return { ok: false, error: "INVALID_TOKEN" };
  return { ok: true, redirect: "/login" };
}
export async function sendVerificationAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "UNAUTHORIZED" };
  if (!checkRateLimit(`verify:${actor.userId}`, 3, 3600)) {
    return { ok: false, error: "RATE_LIMITED" };
  }
  await sendVerification(getDb(), actor.userId);
  return { ok: true };
}
