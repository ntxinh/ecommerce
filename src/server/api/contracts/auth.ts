import { z } from "zod";

export const RegisterInput = z.object({
  email: z.email().max(254),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
});

export const LoginInput = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});

export const ResetRequestInput = z.object({ email: z.email().max(254) });

export const ResetPasswordInput = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(128),
});
