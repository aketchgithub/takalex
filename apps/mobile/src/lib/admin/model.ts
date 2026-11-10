// Admin rules for access requests and invitations. Pure TypeScript (tested
// by model.test.ts). invite-user and the database enforce the same rules;
// these let the admin see problems before sending.

export type RequestStatus = "submitted" | "reviewed" | "approved" | "invited" | "rejected";
export type RequestRole = "collector" | "site_manager" | "recycler";

export type AccessRequestRow = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: RequestRole;
  siteId: string | null;
  siteName: string | null;
  status: RequestStatus;
  createdAt: string;
  notes: string | null;
};

// ---------------------------------------------------------------- requests

export type RequestFilter = "submitted" | "invited" | "rejected";

// "Submitted" lists every request still waiting for an invitation,
// including ones the admin approved whose invitation did not go through.
const FILTER_STATUSES: Record<RequestFilter, RequestStatus[]> = {
  submitted: ["submitted", "reviewed", "approved"],
  invited: ["invited"],
  rejected: ["rejected"],
};

export const REQUEST_FILTERS: { value: RequestFilter; label: string }[] = [
  { value: "submitted", label: "Submitted" },
  { value: "invited", label: "Invited" },
  { value: "rejected", label: "Rejected" },
];

export function filterRequests(rows: AccessRequestRow[], filter: RequestFilter): AccessRequestRow[] {
  const statuses = FILTER_STATUSES[filter];
  return rows
    .filter((row) => statuses.includes(row.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Statuses invite-user accepts are submitted and approved; reviewed is
// moved to approved by the admin first, like submitted.
export function isOpenRequest(status: RequestStatus): boolean {
  return FILTER_STATUSES.submitted.includes(status);
}

export function requestStatusLabel(status: RequestStatus): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "reviewed":
      return "Reviewed";
    case "approved":
      return "Approved, invitation not sent yet";
    case "invited":
      return "Invited";
    case "rejected":
      return "Rejected";
  }
}

export function contactLabel(email: string | null, phone: string | null): string {
  const parts = [email?.trim(), phone?.trim()].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : "No contact details";
}

// A collector's site is their group.
export function groupLabel(role: RequestRole, siteName: string | null, siteId: string | null): string {
  if (!siteId) return role === "collector" ? "No group chosen" : "No site chosen";
  const name = siteName ?? "Unknown site";
  return role === "collector" ? `${name} group` : name;
}

export type InvitePrefill = {
  fullName: string;
  email: string;
  role: RequestRole;
  siteIds: string[];
};

export function invitePrefill(request: AccessRequestRow): InvitePrefill {
  return {
    fullName: request.fullName.trim(),
    email: request.email?.trim() ?? "",
    role: request.role,
    siteIds: request.siteId ? [request.siteId] : [],
  };
}

export const NO_EMAIL_NOTE =
  "No email on this request: confirm it with the requester by phone and enter it below.";

const normaliseEmail = (value: string) => value.trim().toLowerCase();

// invite-user's rule: if the request has an email, the invited email must
// match it (case-insensitive); if not, any valid email the admin entered.
export function requestEmailError(requestEmail: string | null, entered: string): string | null {
  const onRequest = requestEmail ? normaliseEmail(requestEmail) : "";
  if (onRequest && normaliseEmail(entered) !== onRequest) {
    return `The email must match the one on the request (${requestEmail?.trim()}).`;
  }
  return null;
}

export function checkRejectionNote(text: string): { note: string | null; error: string | null } {
  const note = text.trim();
  return note ? { note, error: null } : { note: null, error: "Enter a note explaining the rejection." };
}

// ---------------------------------------------------------------- invitations

export type InvitationDisplayStatus = "pending" | "accepted" | "expired" | "revoked" | "superseded";

// Expiry is computed from expires_at (the database never relies on a job
// setting status = 'expired').
export function invitationDisplayStatus(
  status: string,
  expiresAt: string,
  now: Date = new Date(),
): InvitationDisplayStatus {
  if (status === "pending") {
    const expiry = Date.parse(expiresAt);
    return Number.isFinite(expiry) && expiry <= now.getTime() ? "expired" : "pending";
  }
  if (status === "accepted" || status === "expired" || status === "revoked" || status === "superseded") {
    return status;
  }
  // Unknown values are shown as revoked-like: no actions offered.
  return "superseded";
}

export const INVITATION_STATUS_LABELS: Record<InvitationDisplayStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  expired: "Expired",
  revoked: "Revoked",
  superseded: "Superseded",
};

// revoke_invitation accepts pending rows; reissue_invitation accepts revoked
// rows and pending rows past their expiry.
export function invitationActions(display: InvitationDisplayStatus): { revoke: boolean; reissue: boolean } {
  return { revoke: display === "pending", reissue: display === "expired" || display === "revoked" };
}

export const MAX_FAILED_ATTEMPTS = 5;

export type InvitationFilter = "all" | InvitationDisplayStatus;

export const INVITATION_FILTERS: { value: InvitationFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
  { value: "accepted", label: "Accepted" },
  { value: "all", label: "All" },
];

// ---------------------------------------------------------------- sharing

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "in 7 days";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "in 7 days";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `on ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hh}:${mm}`;
}

export function inviteShareMessage(input: {
  roleLabel: string;
  email: string;
  code: string;
  expiresAt: string | null;
}): string {
  return (
    `You have been invited to Takalex as a ${input.roleLabel.toLowerCase()}.\n\n` +
    `Email: ${input.email}\n` +
    `Invitation code: ${input.code}\n\n` +
    `Open the Takalex app, tap "I have an invitation code" and enter this email and code. ` +
    `The code expires ${formatExpiry(input.expiresAt)}.`
  );
}
