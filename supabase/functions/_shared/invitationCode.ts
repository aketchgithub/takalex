// Invitation code normalisation and hashing, shared by invite-user (which
// hashes the code it generates) and accept-invitation (which hashes the code
// the invitee types). Both must use exactly this logic, or valid codes would
// never match.
//
// The database only ever receives the lowercase hex SHA-256 of the
// normalised code.

// Uppercase, with whitespace and hyphens removed, so "abcd-efgh-jkmn",
// "ABCD EFGH JKMN" and "ABCDEFGHJKMN" are the same code.
export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normaliseCode(code)),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
