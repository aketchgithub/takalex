// Full-screen in-app camera for delivery evidence (expo-camera, works in
// Expo Go). Only the camera can supply the photo: there is no gallery picker.

import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { uiColors } from "@/components/Ui";

export type CapturedPhoto = { uri: string; width: number; height: number; capturedAt: Date };

export function EvidenceCamera({
  visible,
  onCaptured,
  onCancel,
}: {
  visible: boolean;
  onCaptured: (photo: CapturedPhoto) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = async () => {
    if (!camera.current || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.8 });
      onCaptured({
        uri: picture.uri,
        width: picture.width,
        height: picture.height,
        capturedAt: new Date(),
      });
    } catch {
      setError("The photo could not be taken. Try again.");
    } finally {
      setCapturing(false);
    }
  };

  let body;
  if (!permission) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={uiColors.white} />
      </View>
    );
  } else if (!permission.granted) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.text}>
          Takalex needs the camera to photograph each delivery for your site manager.
        </Text>
        {permission.canAskAgain ? (
          <CameraButton label="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <>
            <Text style={styles.text}>Camera access is turned off for Takalex. Allow it in Settings.</Text>
            <CameraButton label="Open Settings" onPress={() => void Linking.openSettings()} />
          </>
        )}
      </View>
    );
  } else {
    body = (
      <>
        <CameraView
          ref={camera}
          style={styles.camera}
          facing="back"
          animateShutter
          onCameraReady={() => setReady(true)}
          onMountError={() => setError("The camera could not start. Close this and try again.")}
        />
        {error ? <Text style={[styles.text, styles.error]}>{error}</Text> : null}
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            accessibilityState={{ disabled: !ready || capturing, busy: capturing }}
            disabled={!ready || capturing}
            onPress={() => void capture()}
            style={[styles.shutter, !ready || capturing ? styles.disabled : null]}
          >
            {capturing ? <ActivityIndicator color={uiColors.primary} /> : null}
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onCancel}
      onShow={() => {
        setReady(false);
        setError(null);
      }}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Photograph the delivery</Text>
          <CameraButton label="Cancel" onPress={onCancel} />
        </View>
        {body}
      </SafeAreaView>
    </Modal>
  );
}

function CameraButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#000", flex: 1 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  title: { color: uiColors.white, fontSize: 17, fontWeight: "700" },
  camera: { flex: 1 },
  centered: { alignItems: "center", flex: 1, gap: 16, justifyContent: "center", padding: 24 },
  text: { color: uiColors.white, fontSize: 15, lineHeight: 22, textAlign: "center" },
  error: { paddingHorizontal: 16, paddingVertical: 8 },
  controls: { alignItems: "center", paddingVertical: 20 },
  shutter: {
    alignItems: "center",
    backgroundColor: uiColors.white,
    borderColor: "#cfd6c8",
    borderRadius: 38,
    borderWidth: 5,
    height: 76,
    justifyContent: "center",
    width: 76,
  },
  disabled: { opacity: 0.5 },
  button: { paddingHorizontal: 12, paddingVertical: 10 },
  buttonText: { color: uiColors.white, fontSize: 16, fontWeight: "600" },
});
