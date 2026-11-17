// "Forgot password?" by SMS code (phone, the default) or email code, and
// verifying a phone number for it: input rules and messages. Pure
// TypeScript, tested by passwordReset.test.ts; the auth store does the
// Supabase calls:
//   phone  signInWithOtp (shouldCreateUser false) -> verifyOtp type "sms"
//   email  resetPasswordForEmail -> verifyOtp type "recovery"
//   then   updateUser({ password })
//   adding a number: updateUser({ phone }) -> verifyOtp type "phone_change"
//
// Nothing here logs, stores or returns a code or a password, and the server's
// own text is never shown. The request step answers the same way whether or
// not the number or email has an account.

import { isNetworkError } from "./outbox/errors.ts";
import type { RemoteError } from "./outbox/types.ts";

// The code's length is an Auth setting (8 locally, supabase/config.toml);
// accept the range Supabase allows so a different hosted setting still works.
export const MIN_RESET_CODE_LENGTH = 6;
export const MAX_RESET_CODE_LENGTH = 10;

// Spaces and hyphens are allowed when typing or pasting the code.
export function normaliseResetCode(input: string): string {
  return input.replace(/[\s-]/g, "");
}

export type ResetChannel = "phone" | "email";

const CODE_SOURCE: Record<ResetChannel, string> = { phone: "SMS", email: "email" };

export function resetCodeError(input: string, channel: ResetChannel = "email"): string | null {
  const code = normaliseResetCode(input);
  const source = CODE_SOURCE[channel];
  if (code.length === 0) return `Enter the code from the ${source}.`;
  if (!/^\d+$/.test(code) || code.length < MIN_RESET_CODE_LENGTH || code.length > MAX_RESET_CODE_LENGTH) {
    return `The code is the number in the ${source}. Check it and try again.`;
  }
  return null;
}

// ---------------------------------------------------------------- request

export const RESET_CODE_SENT_MESSAGE =
  "If an account uses this email, we have sent it a code. It can take a few minutes; check your spam folder too.";

export const RESET_SMS_SENT_MESSAGE =
  "If an account uses this number, we have sent it a code by SMS. It can take a minute or two.";

// A second request within a minute is refused for an email that has an
// account but not for one that has none; answering both the same way keeps
// the screen from telling them apart.
export const RESET_ALREADY_SENT_MESSAGE =
  "If an account uses this email, a code has been sent. Use the code from the most recent email, or wait a minute before asking for a new one.";

export const RESET_SMS_ALREADY_SENT_MESSAGE =
  "If an account uses this number, a code has been sent. Use the code from the most recent SMS, or wait a minute before asking for a new one.";

export type ResetRequestOutcome =
  | { kind: "sent" | "already_sent"; message: string }
  | { kind: "network" | "unavailable" | "other"; message: string };

export const RESET_REQUEST_MESSAGES = {
  network: "Could not reach Takalex. Check your connection and try again.",
  // The hosted project's built-in sender only emails the project team until
  // Chemolex's email service is set up (custom SMTP).
  unavailable: "Password reset by email is not switched on yet. Ask your administrator for help.",
  // No SMS provider is set up on the server yet.
  smsUnavailable: "Password reset by SMS is not switched on yet. Try email instead, or ask your administrator for help.",
  other: "Could not send a code right now. Try again in a few minutes.",
} as const;

// Auth's answers when asked to text a code to a number with no account
// (shouldCreateUser false). Shown as "sent", so the screen never tells
// numbers with an account from numbers without one.
const NO_SUCH_PHONE_CODES = new Set(["otp_disabled", "user_not_found", "signup_disabled"]);

// error null: the request was accepted.
export function resetRequestOutcome(error: RemoteError | null, channel: ResetChannel = "email"): ResetRequestOutcome {
  const phone = channel === "phone";
  const sent = { kind: "sent" as const, message: phone ? RESET_SMS_SENT_MESSAGE : RESET_CODE_SENT_MESSAGE };
  if (!error) return sent;
  if (isNetworkError(error)) return { kind: "network", message: RESET_REQUEST_MESSAGES.network };
  const code = error.code ?? "";
  if (error.status === 429 || /rate_limit/.test(code)) {
    return { kind: "already_sent", message: phone ? RESET_SMS_ALREADY_SENT_MESSAGE : RESET_ALREADY_SENT_MESSAGE };
  }
  if (phone) {
    if (NO_SUCH_PHONE_CODES.has(code) || /signups not allowed/i.test(error.message)) return sent;
    if (code === "phone_provider_disabled" || code === "sms_send_failed") {
      return { kind: "unavailable", message: RESET_REQUEST_MESSAGES.smsUnavailable };
    }
    return { kind: "other", message: RESET_REQUEST_MESSAGES.other };
  }
  if (code === "email_address_not_authorized") {
    return { kind: "unavailable", message: RESET_REQUEST_MESSAGES.unavailable };
  }
  return { kind: "other", message: RESET_REQUEST_MESSAGES.other };
}

// ---------------------------------------------------------------- verify

export type ResetVerifyFailureKind = "invalid_code" | "network" | "rate_limited" | "other";

export const RESET_VERIFY_MESSAGES: Record<ResetVerifyFailureKind, string> = {
  invalid_code: "This code is wrong or has expired. Check it, or ask for a new code.",
  network: "Could not reach Takalex. Check your connection and try again.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  other: "The code could not be checked right now. Try again in a few minutes.",
};

export function resetVerifyFailureKind(error: RemoteError): ResetVerifyFailureKind {
  if (isNetworkError(error)) return "network";
  const code = error.code ?? "";
  if (error.status === 429 || /rate_limit/.test(code)) return "rate_limited";
  // Auth answers a wrong, used or expired code with 403 otp_expired (older
  // servers: 401 or 403 with no code).
  if (code === "otp_expired" || code === "otp_disabled" || error.status === 401 || error.status === 403) {
    return "invalid_code";
  }
  return "other";
}

export function resetVerifyErrorMessage(error: RemoteError): string {
  return RESET_VERIFY_MESSAGES[resetVerifyFailureKind(error)];
}

export const PASSWORD_RESET_DONE_MESSAGE = "Your password has been changed. You are signed in.";

// ---------------------------------------------------------------- adding a number

export const PHONE_CODE_SENT_MESSAGE = "We have sent a code by SMS to this number. It can take a minute or two.";
export const PHONE_SAVED_MESSAGE = "Your phone number is saved. You can use it to reset your password.";

export const PHONE_CHANGE_MESSAGES = {
  network: "Could not reach Takalex. Check your connection and try again.",
  rateLimited: "Please wait a minute before asking for another code.",
  taken: "This number is already used by another Takalex account. Use a different number, or ask your administrator for help.",
  unavailable: "SMS is not switched on yet, so phone numbers cannot be added for now.",
  invalid: "Check the phone number and try again.",
  session: "Your session has expired. Sign out and sign in again.",
  other: "Could not send a code right now. Try again in a few minutes.",
} as const;

// For updateUser({ phone }), which texts a code to the new number.
export function phoneChangeErrorMessage(error: RemoteError): string {
  if (isNetworkError(error)) return PHONE_CHANGE_MESSAGES.network;
  const code = error.code ?? "";
  if (error.status === 429 || /rate_limit/.test(code)) return PHONE_CHANGE_MESSAGES.rateLimited;
  if (code === "phone_exists" || /already (been )?registered|already exists/i.test(error.message)) return PHONE_CHANGE_MESSAGES.taken;
  if (code === "phone_provider_disabled" || code === "sms_send_failed") return PHONE_CHANGE_MESSAGES.unavailable;
  if (code === "validation_failed") return PHONE_CHANGE_MESSAGES.invalid;
  if (error.status === 401 || code === "session_not_found" || code === "session_expired" || error.name === "AuthSessionMissingError") {
    return PHONE_CHANGE_MESSAGES.session;
  }
  return PHONE_CHANGE_MESSAGES.other;
}
