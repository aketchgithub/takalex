// Wording for confirmation dialogs in a web browser, where the native
// dialog has a single text area (lib/dialogs.ts). Pure TypeScript, tested by
// dialogText.test.ts.

// "Title\n\nMessage", or just the title when there is no message.
export function browserDialogText(title: string, message?: string): string {
  const body = message?.trim();
  return body ? `${title}\n\n${body}` : title;
}
