import { z } from "zod";

/**
 * A second way in for people without a Google account: a name and a PIN.
 *
 * The pair is backed by an ordinary Supabase Auth password account, so sessions,
 * refresh, and every API check behave exactly as they do for Google. Nobody is
 * asked for an email address; one is derived from the name and kept internal.
 * The domain is a reserved TLD that can never receive mail (RFC 2606).
 */
export const PIN_LENGTH = 6;
const PIN_ACCOUNT_DOMAIN = "pin.caddystack.invalid";

export const pinNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(60, "That name is too long.");

export const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, `Your PIN is ${PIN_LENGTH} digits.`);

export const pinCredentialsSchema = z.object({ name: pinNameSchema, pin: pinSchema });

export type PinCredentials = z.infer<typeof pinCredentialsSchema>;

/**
 * Names are matched without case or punctuation so one person always lands on
 * the same account however they type it. The name as typed is kept for display.
 */
export function pinAccountSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function pinAccountEmail(name: string): string {
  const slug = pinAccountSlug(name);
  if (!slug) throw new Error("Use at least one letter or number in your name.");
  return `${slug}@${PIN_ACCOUNT_DOMAIN}`;
}
