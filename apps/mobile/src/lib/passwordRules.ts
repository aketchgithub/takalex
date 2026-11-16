// Password rules and change-password decisions. Pure TypeScript, tested by
// passwordRules.test.ts. Used by the activate and change-password screens;
// the auth store does the Supabase calls.
//
// Nothing here logs, stores or returns a password: only messages come out.

import { isNetworkError } from "./outbox/errors.ts";
import type { RemoteError } from "./outbox/types.ts";

// Mirror accept-invitation's input rules so most mistakes are caught before
// the request (the server enforces its own rules again).
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;
export const PASSWORD_RULE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters (and at most ${MAX_PASSWORD_BYTES} bytes).`;
export const PASSWORDS_DO_NOT_MATCH = "The passwords do not match.";

export const CURRENT_PASSWORD_REQUIRED = "Enter your current password.";
export const NEW_PASSWORD_MUST_DIFFER =
  "The new password must be different from your current password.";

// The rule message when the password breaks a rule, otherwise null.
export function passwordRuleError(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH ||
    new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES
    ? PASSWORD_RULE
    : null;
}

export type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
};

export type PasswordChangeFieldErrors = Partial<
  Record<"currentPassword" | "newPassword" | "confirmation", string>
>;

// Empty object: the form may be submitted.
export function validatePasswordChange(input: PasswordChangeInput): PasswordChangeFieldErrors {
  const errors: PasswordChangeFieldErrors = {};

  if (input.currentPassword.length === 0) {
    errors.currentPassword = CURRENT_PASSWORD_REQUIRED;
  }

  const ruleError = passwordRuleError(input.newPassword);
  if (ruleError) {
    errors.newPassword = ruleError;
  } else if (input.newPassword === input.currentPassword) {
    errors.newPassword = NEW_PASSWORD_MUST_DIFFER;
  }

  if (input.confirmation !== input.newPassword) {
    errors.confirmation = PASSWORDS_DO_NOT_MATCH;
  }

  return errors;
}

export type PasswordChangeFailureKind =
  | "wrong_current"
  | "weak"
  | "same"
  | "network"
  | "rate_limited"
  | "session"
  | "other";

export type PasswordChangeFailure = { kind: PasswordChangeFailureKind; message: string };

export const PASSWORD_CHANGE_MESSAGES: Record<PasswordChangeFailureKind, string> = {
  wrong_current: "The current password is not correct. Your password was not changed.",
  weak: "The new password is too weak. Choose a longer or less common password.",
  same: NEW_PASSWORD_MUST_DIFFER,
  network: "Could not reach Takalex. Check your connection and try again.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  session: "Your session has expired. Sign out and sign in again.",
  other: "Your password could not be changed. Try again later.",
};

export const PASSWORD_CHANGED_MESSAGE =
  "Your password has been changed. Use the new password the next time you sign in.";

// verify: re-authentication with the current password.
// update: setting the new password.
export type PasswordChangeStage = "verify" | "update";

// Turns a Supabase Auth error into one plain message. The server's own text
// is never shown.
export function classifyPasswordChangeError(
  stage: PasswordChangeStage,
  error: RemoteError,
): PasswordChangeFailure {
  const kind = failureKind(stage, error);
  return { kind, message: PASSWORD_CHANGE_MESSAGES[kind] };
}

function failureKind(stage: PasswordChangeStage, error: RemoteError): PasswordChangeFailureKind {
  // No answer from the server: no connection, refused, timeout.
  if (isNetworkError(error)) return "network";

  const code = error.code ?? "";
  const status = error.status;

  if (status === 429 || /rate_limit/.test(code)) return "rate_limited";

  if (stage === "verify") {
    // Older Auth servers send no code: 400 with "Invalid login credentials".
    if (code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) {
      return "wrong_current";
    }
    return "other";
  }

  if (code === "weak_password" || error.name === "AuthWeakPasswordError") return "weak";
  if (code === "same_password") return "same";
  if (
    status === 401 ||
    status === 403 ||
    code === "session_not_found" ||
    code === "session_expired" ||
    error.name === "AuthSessionMissingError"
  ) {
    return "session";
  }
  return "other";
}
