// Confirmations and notices that work on phones and in a web browser.
// React Native's Alert.alert shows nothing in a browser (react-native-web),
// so an action behind it would silently never run there. On Android and iOS
// these use Alert.alert; on the web, the browser's own confirm / alert.
//
//   if (await confirmAction({ title, message, confirmLabel: "Delete", destructive: true })) { ... }
//   await showNotice({ title: "Delivery approved", message: "..." });

import { Alert, Platform } from "react-native";

import { browserDialogText } from "@/lib/dialogText";

// The browser's dialogs, typed here so this file does not depend on the DOM
// type library.
const browser = globalThis as { confirm?: (text: string) => boolean; alert?: (text: string) => void };

export function confirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(browser.confirm?.(browserDialogText(title, message)) ?? false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      // Tapping outside the dialog (Android) counts as Cancel.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

// A message with one OK button; resolves when it is closed.
export function showNotice({ title, message }: { title: string; message?: string }): Promise<void> {
  if (Platform.OS === "web") {
    browser.alert?.(browserDialogText(title, message));
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [{ text: "OK", onPress: () => resolve() }], {
      cancelable: true,
      onDismiss: () => resolve(),
    });
  });
}
