// Pure rules for the delivery-location permission (no expo imports, so they
// can be unit tested). Android reports "denied" (not "undetermined") after a
// single refusal and after an "Ask every time" / one-time grant expires, while
// still allowing the app to ask again. So the app asks whenever it may.

export type PermissionSnapshot = {
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
};

// Show the system prompt? Yes whenever it is not granted and the system still
// lets the app ask.
export function shouldRequestPermission(permission: PermissionSnapshot): boolean {
  return permission.status !== "granted" && permission.canAskAgain;
}

// After asking (or not being allowed to ask): granted, refused this time
// (the prompt can be shown again: "Try again"), or blocked (only phone
// Settings can change it: "Open settings").
export function permissionOutcome(permission: PermissionSnapshot): "granted" | "denied" | "blocked" {
  if (permission.status === "granted") return "granted";
  return permission.canAskAgain ? "denied" : "blocked";
}
