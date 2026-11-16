import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { Card, Row, SectionHeading, reviewStyles } from "@/components/ReviewUi";
import { DeliveryStatusRow } from "@/components/StatusBadge";
import { Field, InlineLink, Message, PrimaryButton, Screen, SecondaryButton, uiColors, uiStyles } from "@/components/Ui";
import { formatDateTime, formatKg } from "@/lib/outbox/presentation";
import {
  fetchVerifiableMaterials,
  getDeliveryDetail,
  signEvidenceUrl,
  submitReview,
  type DeliveryDetail,
} from "@/lib/review/api";
import {
  approveConfirmation,
  checkBreakdown,
  checkRejectionReason,
  collectorLabel,
  deviceLocationLabel,
  rejectConfirmation,
  unusedMaterials,
  type BreakdownLine,
  type VerifiableMaterial,
} from "@/lib/review/model";

// A Stack screen: every open pushes a new instance and Back unmounts it, so
// each visit starts with fresh state, a fresh read and a fresh signed URL.
// The key also resets the content if the id param ever changes in place.
export default function DeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) {
    return (
      <Screen align="top" brand={false}>
        <Message tone="error">No delivery was selected.</Message>
      </Screen>
    );
  }
  return <DeliveryContent key={id} id={id} />;
}

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "missing" }
  | { status: "ready"; delivery: DeliveryDetail };

function DeliveryContent({ id }: { id: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<DetailState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    getDeliveryDetail(id)
      .then((delivery) => {
        if (active) setDetail(delivery ? { status: "ready", delivery } : { status: "missing" });
      })
      .catch((error: unknown) => {
        if (active) {
          setDetail({ status: "error", message: error instanceof Error ? error.message : "Could not load this delivery." });
        }
      });
    return () => {
      active = false;
    };
  }, [id, version]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(manager)/(tabs)");
  }, [router]);

  if (detail.status === "loading") {
    return (
      <Screen align="top" brand={false}>
        <Message>Loading the delivery…</Message>
      </Screen>
    );
  }
  if (detail.status === "error") {
    return (
      <Screen align="top" brand={false}>
        <Message tone="error">{detail.message}</Message>
        <InlineLink label="Try again" onPress={() => setVersion((v) => v + 1)} />
        <InlineLink label="Back" onPress={goBack} />
      </Screen>
    );
  }
  if (detail.status === "missing") {
    return (
      <Screen align="top" brand={false}>
        <Message tone="error">This delivery was not found, or it is not at one of your sites.</Message>
        <InlineLink label="Back" onPress={goBack} />
      </Screen>
    );
  }

  const delivery = detail.delivery;
  return (
    <Screen align="top" brand={false} title={collectorLabel(delivery.collectorName)} subtitle={delivery.siteName ?? "Unknown site"}>
      <Card>
        <DeliveryStatusRow status={delivery.status} rejectionReason={delivery.rejectionReason} />
        <Row label="Submitted to Takalex" value={formatDateTime(delivery.submittedAt)} />
        {delivery.verifiedAt ? <Row label="Reviewed" value={formatDateTime(delivery.verifiedAt)} /> : null}
      </Card>

      <View style={reviewStyles.section}>
        <SectionHeading note="Reported by collector. Not verified.">Reported by collector</SectionHeading>
        <Card>
          <Row label="Material" value={delivery.materialName ?? delivery.materialCode} />
          <Row label="Weight" value={formatKg(delivery.reportedWeightKg)} />
        </Card>
      </View>

      <View style={reviewStyles.section}>
        <SectionHeading note="Recorded by the collector's phone. Not verified.">Device-reported</SectionHeading>
        <Card>
          <Row
            label="Capture time"
            value={delivery.capturedAt ? formatDateTime(delivery.capturedAt) : "Not recorded"}
          />
          <Row
            label="Location"
            stacked
            value={deviceLocationLabel(delivery.deviceLatitude, delivery.deviceLongitude, delivery.deviceAccuracyM)}
          />
        </Card>
      </View>

      <EvidencePhoto delivery={delivery} />

      {delivery.status === "pending" ? (
        <ReviewForm delivery={delivery} onDone={goBack} />
      ) : (
        <Message>This delivery has been reviewed. Reviews are final.</Message>
      )}
    </Screen>
  );
}

function EvidencePhoto({ delivery }: { delivery: DeliveryDetail }) {
  const photo = delivery.evidence[0] ?? null;
  const storagePath = photo?.storagePath ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(storagePath !== null);
  // Bumped by "Reload photo": signs a fresh short-lived URL.
  const [signVersion, setSignVersion] = useState(0);

  useEffect(() => {
    if (!storagePath) return;
    let active = true;
    signEvidenceUrl(storagePath)
      .then((signed) => {
        if (active) setUrl(signed);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Could not open the photo.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [storagePath, signVersion]);

  const load = () => {
    setLoading(true);
    setError(null);
    setUrl(null);
    setSignVersion((v) => v + 1);
  };

  return (
    <View style={reviewStyles.section}>
      <SectionHeading
        note={photo?.capturedAt ? `Taken ${formatDateTime(photo.capturedAt)} (device-reported)` : undefined}
      >
        Photo
      </SectionHeading>
      {!photo ? (
        <Message>Waiting for the collector’s photo to upload.</Message>
      ) : null}
      {loading ? <ActivityIndicator color={uiColors.primary} /> : null}
      {error ? <Message tone="error">{error}</Message> : null}
      {url && !loading ? (
        <Image
          accessibilityLabel="Delivery photo"
          resizeMode="contain"
          source={{ uri: url }}
          style={styles.photo}
          onError={() => {
            setUrl(null);
            setError("The photo could not be shown (the link may have expired).");
          }}
        />
      ) : null}
      {photo ? <InlineLink label="Reload photo" onPress={load} /> : null}
      {delivery.evidence.length > 1 ? (
        <Text style={reviewStyles.meta}>{delivery.evidence.length} photos were uploaded; the first is shown.</Text>
      ) : null}
    </View>
  );
}

let lineCounter = 0;
function newLine(materialCode: string | null = null): BreakdownLine {
  lineCounter += 1;
  return { key: `line-${lineCounter}`, materialCode, weightText: "" };
}

type MaterialsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; materials: VerifiableMaterial[] };

function ReviewForm({ delivery, onDone }: { delivery: DeliveryDetail; onDone: () => void }) {
  const [materials, setMaterials] = useState<MaterialsState>({ status: "loading" });
  const [materialsVersion, setMaterialsVersion] = useState(0);
  const [lines, setLines] = useState<BreakdownLine[]>(() => [newLine()]);
  const [showApproveErrors, setShowApproveErrors] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  // review_collection's refusal, shown next to the button that was pressed.
  const [serverError, setServerError] = useState<{ kind: "approve" | "reject"; message: string } | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    fetchVerifiableMaterials()
      .then((list) => {
        if (active) setMaterials({ status: "ready", materials: list });
      })
      .catch((error: unknown) => {
        if (active) {
          setMaterials({ status: "error", message: error instanceof Error ? error.message : "Could not load materials." });
        }
      });
    return () => {
      active = false;
    };
  }, [materialsVersion]);

  const list = useMemo(() => (materials.status === "ready" ? materials.materials : []), [materials]);
  const check = useMemo(() => checkBreakdown(lines, list), [lines, list]);
  const free = unusedMaterials(lines, list);

  const updateLine = (key: string, change: Partial<BreakdownLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const send = async (decision: Parameters<typeof submitReview>[1], kind: "approve" | "reject") => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(kind);
    setServerError(null);
    try {
      const failure = await submitReview(delivery.id, decision);
      if (failure) {
        setServerError({ kind, message: failure });
        return;
      }
      Alert.alert(
        kind === "approve" ? "Delivery approved" : "Delivery rejected",
        kind === "approve"
          ? "The verified breakdown was saved. The delivery is eligible for payment."
          : "The rejection and its reason were saved.",
        [{ text: "OK", onPress: onDone }],
        { cancelable: false },
      );
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  };

  // review_collection refuses approval without an evidence row; Reject
  // stays available.
  const hasPhoto = delivery.evidence.length > 0;

  const approve = () => {
    if (!hasPhoto) return;
    setShowApproveErrors(true);
    setServerError(null);
    const items = check.items;
    if (!items) return;
    Alert.alert("Approve this delivery?", approveConfirmation(check.totalText), [
      { text: "Cancel", style: "cancel" },
      { text: "Approve", onPress: () => void send({ approved: true, items }, "approve") },
    ]);
  };

  const reject = () => {
    setServerError(null);
    const { reason, error } = checkRejectionReason(reasonText);
    setReasonError(error);
    if (!reason) return;
    Alert.alert("Reject this delivery?", rejectConfirmation(reason), [
      { text: "Cancel", style: "cancel" },
      { text: "Reject", style: "destructive", onPress: () => void send({ approved: false, reason }, "reject") },
    ]);
  };

  return (
    <>
      <View style={reviewStyles.section}>
        <SectionHeading note="Sort and weigh the delivery, then record each material and its verified weight.">
          Verified breakdown
        </SectionHeading>

        {materials.status === "loading" ? <Message>Loading materials…</Message> : null}
        {materials.status === "error" ? (
          <>
            <Message tone="error">{materials.message}</Message>
            <InlineLink label="Try again" onPress={() => setMaterialsVersion((v) => v + 1)} />
          </>
        ) : null}

        {materials.status === "ready"
          ? lines.map((line, index) => {
              const errors = showApproveErrors ? check.lineErrors[index] : {};
              return (
                <Card key={line.key}>
                  <View style={styles.lineHeader}>
                    <Text style={reviewStyles.title}>Line {index + 1}</Text>
                    {lines.length > 1 ? (
                      <InlineLink
                        label="Remove"
                        onPress={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.label}>Verified material</Text>
                  <View style={styles.chips}>
                    {list.map((material) => {
                      const selected = line.materialCode === material.code;
                      const usedElsewhere = !selected && lines.some((l) => l.materialCode === material.code);
                      return (
                        <Pressable
                          key={material.code}
                          accessibilityRole="radio"
                          accessibilityState={{ selected, disabled: usedElsewhere }}
                          disabled={usedElsewhere || busy !== null}
                          onPress={() => updateLine(line.key, { materialCode: material.code })}
                          style={[styles.chip, selected ? styles.chipSelected : null, usedElsewhere ? styles.chipDisabled : null]}
                        >
                          <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                            {material.displayName}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {errors.material ? <Text style={styles.error}>{errors.material}</Text> : null}
                  <Field
                    editable={busy === null}
                    error={errors.weight}
                    keyboardType="decimal-pad"
                    label="Verified weight (kg)"
                    onChangeText={(text) => updateLine(line.key, { weightText: text })}
                    placeholder="e.g. 3.25"
                    value={line.weightText}
                  />
                </Card>
              );
            })
          : null}

        {materials.status === "ready" ? (
          <>
            <SecondaryButton
              disabled={free.length === 0 || busy !== null}
              label={free.length === 0 ? "All materials added" : "Add material line"}
              onPress={() => setLines((current) => [...current, newLine()])}
            />
            <Card>
              <Row label="Verified total" value={`${check.totalText} kg`} />
              <Text style={reviewStyles.meta}>
                Sum of {check.countedLines} of {lines.length} line{lines.length === 1 ? "" : "s"} with a valid weight.
                Reported by collector: {formatKg(delivery.reportedWeightKg)}.
              </Text>
            </Card>
            {showApproveErrors && check.formError ? <Message tone="error">{check.formError}</Message> : null}
            {showApproveErrors && !check.items && !check.formError ? (
              <Message tone="error">Fix the highlighted lines before approving.</Message>
            ) : null}
            <PrimaryButton
              disabled={!hasPhoto || busy === "reject"}
              label="Approve (eligible for payment)"
              loading={busy === "approve"}
              onPress={approve}
            />
            {!hasPhoto ? <Message>Waiting for the collector’s photo to upload.</Message> : null}
            {serverError?.kind === "approve" ? <Message tone="error">{serverError.message}</Message> : null}
          </>
        ) : null}
      </View>

      <View style={styles.rejectCard}>
        <SectionHeading note="A rejected delivery is not eligible for payment. The collector sees the reason.">
          Or reject
        </SectionHeading>
        <Field
          autoCapitalize="sentences"
          editable={busy === null}
          error={reasonError ?? undefined}
          label="Reason for rejecting (required)"
          multiline
          onChangeText={(text) => {
            setReasonText(text);
            if (reasonError) setReasonError(null);
          }}
          placeholder="e.g. Bags were wet and full of soil"
          value={reasonText}
        />
        <SecondaryButton
          disabled={busy === "approve"}
          label="Reject"
          loading={busy === "reject"}
          onPress={reject}
          tone="danger"
        />
        {serverError?.kind === "reject" ? <Message tone="error">{serverError.message}</Message> : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  photo: {
    aspectRatio: 3 / 4,
    backgroundColor: "#e8ebe4",
    borderRadius: 12,
    width: "100%",
  },
  lineHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  label: uiStyles.fieldLabel,
  chips: uiStyles.chipRow,
  chip: uiStyles.chip,
  chipSelected: uiStyles.chipSelected,
  chipDisabled: { opacity: 0.4 },
  chipText: uiStyles.chipText,
  chipTextSelected: uiStyles.chipTextSelected,
  // Rejecting is its own card, set apart from the approve section above.
  rejectCard: { ...uiStyles.card, borderColor: uiColors.danger, gap: 12, marginTop: 8 },
  error: { color: uiColors.danger, fontSize: 14 },
});
