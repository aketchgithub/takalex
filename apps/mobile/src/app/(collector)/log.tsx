import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { EvidenceCamera, type CapturedPhoto } from "@/components/EvidenceCamera";
import {
  Field,
  InlineLink,
  Message,
  PrimaryButton,
  Screen,
  SecondaryButton,
  type ScreenScrollView,
  uiColors,
  uiStyles,
} from "@/components/Ui";
import { loadCollectorContext, type CollectorContext } from "@/lib/collectorContext";
import { getOutboxRow, saveSubmission } from "@/lib/outbox";
import { deleteTemporaryPhoto } from "@/lib/outbox/photo";
import { formatDateTime, submitOutcome, type Notice } from "@/lib/outbox/presentation";
import { normalizeReportedWeight } from "@/lib/outbox/validation";
import { locationMessage, useDeliveryLocation } from "@/lib/useDeliveryLocation";
import { useAuthStore } from "@/stores/authStore";

const WEIGHT_ERROR = "Enter a weight above 0 kg with at most two decimals, for example 12.5.";

export default function NewDeliveryScreen() {
  const router = useRouter();
  const profile = useAuthStore((state) => state.profile);

  const [context, setContext] = useState<CollectorContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextVersion, setContextVersion] = useState(0);

  const [selectedCode, setMaterialCode] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [weightError, setWeightError] = useState<string | undefined>();
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [phase, setPhase] = useState<"idle" | "locating" | "saving">("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const submitting = useRef(false);
  const latestSubmission = useRef(0);
  // The submission whose result card the collector has already moved on from.
  const dismissedSubmission = useRef(0);

  const location = useDeliveryLocation();

  // The result of a submit is shown at the top of the form.
  const scrollRef = useRef<ScreenScrollView | null>(null);
  const showNotice = (next: Notice) => {
    setNotice(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  useEffect(() => {
    if (!profile) return;
    let active = true;
    loadCollectorContext(profile)
      .then((result) => {
        if (active) setContext(result);
      })
      .catch((error: unknown) => {
        if (active) setContextError(error instanceof Error ? error.message : "Could not load your site.");
      });
    return () => {
      active = false;
    };
  }, [profile, contextVersion]);

  // Starting the next delivery clears the previous result card (an error
  // stays). A late "uploaded" result for that delivery is then not shown
  // again; a late failure still is.
  const startNext = () => {
    dismissedSubmission.current = latestSubmission.current;
    setNotice((current) => (current && current.tone !== "error" ? null : current));
  };

  const onCaptured = useCallback((captured: CapturedPhoto) => {
    setPhoto((previous) => {
      if (previous) deleteTemporaryPhoto(previous.uri);
      return captured;
    });
    setCameraOpen(false);
  }, []);

  const openCamera = () => {
    startNext();
    setCameraOpen(true);
  };

  const site = context?.site ?? null;
  // Only a material that is currently offered counts as selected.
  const materialCode = context?.materials.some((m) => m.code === selectedCode) ? selectedCode : null;
  const canSubmit = Boolean(site && materialCode && photo) && phase === "idle";

  const submit = async () => {
    if (submitting.current || !site || !materialCode || !photo) return;
    if (!normalizeReportedWeight(weight)) {
      setWeightError(WEIGHT_ERROR);
      return;
    }

    submitting.current = true;
    const submissionId = ++latestSubmission.current;
    setNotice(null);
    let saved: Awaited<ReturnType<typeof saveSubmission>>;
    try {
      setPhase("locating");
      const deviceLocation = await location.waitForLocation();

      setPhase("saving");
      saved = await saveSubmission({
        siteId: site.id,
        materialCode,
        reportedWeight: weight,
        capturedAt: photo.capturedAt,
        location: deviceLocation,
        photoUri: photo.uri,
      });
    } catch (error: unknown) {
      showNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "The delivery could not be saved. Try again.",
      });
      return;
    } finally {
      setPhase("idle");
      submitting.current = false;
    }

    // Safely on the phone: clear the form for the next delivery, then report
    // the upload result (unless a newer delivery has been saved since).
    showNotice({ tone: "info", text: "Saved on this phone, uploading…" });
    setPhoto(null);
    setWeight("");
    setMaterialCode(null);
    location.refresh();

    const summary = await saved.sync;
    const row = await getOutboxRow(saved.row.clientRecordId).catch(() => null);
    if (latestSubmission.current !== submissionId) return;
    const outcome = submitOutcome(summary, row);
    if (dismissedSubmission.current !== submissionId || outcome.tone === "error") setNotice(outcome);
  };

  if (!context) {
    return (
      <Screen align="top" title="New delivery" subtitle="Collector account">
        {contextError ? (
          <>
            <Message tone="error">{contextError}</Message>
            <PrimaryButton
              label="Try again"
              onPress={() => {
                setContextError(null);
                setContextVersion((v) => v + 1);
              }}
            />
          </>
        ) : (
          <Message>Loading your site and materials…</Message>
        )}
      </Screen>
    );
  }

  return (
    <Screen
      align="top"
      scrollRef={scrollRef}
      title="New delivery"
      subtitle="Record what you delivered, then take a photo of it."
    >
      {notice ? (
        <View style={[styles.noticeCard, notice.tone === "error" ? styles.noticeCardError : null]}>
          <Message tone={notice.tone}>{notice.text}</Message>
          <InlineLink label="View history" onPress={() => router.push("/(collector)/history")} />
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>Site</Text>
        {site ? (
          <Text style={styles.value}>{site.name}</Text>
        ) : (
          <Message tone="error">{context.siteProblem}</Message>
        )}
        {context.source === "cache" ? (
          <Text style={styles.hint}>
            Offline: using your site and materials saved on {formatDateTime(context.savedAt)}.
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Material</Text>
        {context.materials.length === 0 ? (
          <Message tone="error">No materials are available. Ask an administrator.</Message>
        ) : (
          <View accessibilityRole="radiogroup" style={styles.options}>
            {context.materials.map((material) => {
              const selected = material.code === materialCode;
              return (
                <Pressable
                  key={material.code}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => {
                    startNext();
                    setMaterialCode(material.code);
                  }}
                  style={[styles.option, selected ? styles.optionSelected : null]}
                >
                  <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>
                    {material.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <Field
        label="Weight (kg)"
        keyboardType="decimal-pad"
        placeholder="e.g. 12.5"
        value={weight}
        error={weightError}
        onChangeText={(text) => {
          startNext();
          setWeight(text);
          setWeightError(undefined);
        }}
        onBlur={() => {
          if (weight.trim() && !normalizeReportedWeight(weight)) setWeightError(WEIGHT_ERROR);
        }}
      />

      <View style={styles.section}>
        <Text style={styles.label}>Photo</Text>
        {photo ? (
          <>
            <Image
              accessibilityLabel="Photo of the delivery"
              source={{ uri: photo.uri }}
              style={[styles.preview, { aspectRatio: photo.width / photo.height || 0.75 }]}
            />
            <SecondaryButton label="Retake" onPress={openCamera} />
          </>
        ) : (
          <SecondaryButton label="Take photo" onPress={openCamera} />
        )}
        <Text style={styles.hint}>{locationMessage(location.state)}</Text>
      </View>

      <PrimaryButton
        label={phase === "locating" ? "Getting location…" : "Submit delivery"}
        loading={phase === "saving"}
        disabled={!canSubmit}
        onPress={() => void submit()}
      />
      {(!photo || !materialCode) && (!notice || notice.tone === "error") ? (
        <Text style={styles.hint}>Choose a material, enter the weight and take a photo to submit.</Text>
      ) : null}

      <EvidenceCamera visible={cameraOpen} onCaptured={onCaptured} onCancel={() => setCameraOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: uiStyles.card,
  // Saved or uploaded: green card. A failure: red border.
  noticeCard: { ...uiStyles.card, backgroundColor: "#e3f1e7", borderColor: uiColors.primary, borderWidth: 1.5 },
  noticeCardError: { backgroundColor: uiColors.white, borderColor: uiColors.danger },
  section: uiStyles.fieldGroup,
  label: uiStyles.fieldLabel,
  value: uiStyles.sectionHeading,
  hint: uiStyles.meta,
  options: uiStyles.chipRow,
  option: uiStyles.chip,
  optionSelected: uiStyles.chipSelected,
  optionText: uiStyles.chipText,
  optionTextSelected: uiStyles.chipTextSelected,
  preview: { backgroundColor: uiColors.border, borderRadius: 12, width: "100%" },
});
