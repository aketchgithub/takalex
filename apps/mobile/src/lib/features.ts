// Feature switches, set at build time. EXPO_PUBLIC_* values are bundled into
// the app when it is built (EAS environment variables for the APK,
// .env.local for local development), so changing one needs a new build.
// Only the exact value "true" (any case, spaces ignored) turns a switch on;
// a missing or misspelt value leaves it off.

export function isSwitchOn(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

// SMS codes for "Forgot password?" and the "Add phone number" screen. Off
// until Chemolex has an SMS provider set up on the hosted project; while off,
// password reset is by email only and phone numbers are not offered
// (docs/password-reset.md).
export const SMS_PASSWORD_RESET = isSwitchOn(process.env.EXPO_PUBLIC_SMS_PASSWORD_RESET);
