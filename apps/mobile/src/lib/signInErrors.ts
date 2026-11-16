// Sign-in failure messages. Pure TypeScript, tested by signInErrors.test.ts;
// the auth store does the Supabase call.
//
// The server's own text is never shown. A wrong email and a wrong password
// read the same, so the message never reveals whether an account exists.

import { isNetworkError } from "./outbox/errors.ts";
import type { RemoteError } from "./outbox/types.ts";

export type SignInFailureKind = "wrong_credentials" | "network" | "rate_limited" | "other";

export const SIGN_IN_MESSAGES: Record<SignInFailureKind, string> = {
  wrong_credentials: "The email or password is not correct. Check both and try again.",
  network: "Could not reach Takalex. Check your connection and try again.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes and try again.",
  other: "Could not sign in right now. Try again in a few minutes.",
};

export function signInFailureKind(error: RemoteError): SignInFailureKind {
  // No answer from the server: no connection, refused, timeout.
  if (isNetworkError(error)) return "network";

  const code = error.code ?? "";
  if (error.status === 429 || /rate_limit/.test(code)) return "rate_limited";

  // Older Auth servers send no code: 400 with "Invalid login credentials".
  if (code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) {
    return "wrong_credentials";
  }
  return "other";
}

export function signInErrorMessage(error: RemoteError): string {
  return SIGN_IN_MESSAGES[signInFailureKind(error)];
}
