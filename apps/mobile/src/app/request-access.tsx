import { useState } from "react";
import { router } from "expo-router";

import { Field, Message, PrimaryButton, Screen } from "@/components/Ui";
import { submitAccessRequest, submitAccessRequestSchema } from "@/lib/access";

export default function RequestAccessScreen() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"collector" | "site_manager" | "recycler">("collector");
  const [siteName, setSiteName] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    // Same schema submitAccessRequest uses, including the
    // "email or phone required" rule, so the form and submission agree.
    const parsed = submitAccessRequestSchema.safeParse({
      full_name: fullName,
      email,
      phone,
      role,
      site_name: siteName,
      referral_source: referralSource,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the request details.");
      setStatus(null);
      return;
    }

    setLoading(true);
    setError(null);
    setStatus(null);

    const { error: submitError } = await submitAccessRequest(parsed.data);

    setLoading(false);

    if (submitError) {
      setError(submitError.message);
      return;
    }

    setStatus(
      "Your request has been submitted. An administrator will review it and send an invite if approved.",
    );
    setFullName("");
    setEmail("");
    setPhone("");
    setSiteName("");
    setReferralSource("");
    setRole("collector");
  };

  return (
    <Screen
      title="Request access"
      subtitle="Public discovery is open, but operational access is controlled through a verified invitation flow."
    >
      <Field
        label="Full name"
        value={fullName}
        onChangeText={setFullName}
        placeholder="Your full name"
      />
      <Field
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        label="Email address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
      />
      <Field
        autoComplete="tel"
        keyboardType="phone-pad"
        label="Phone number"
        value={phone}
        onChangeText={setPhone}
        placeholder="+254712345678"
      />
      <Field
        label="Role interested in"
        value={role}
        onChangeText={(text) => {
          const nextRole = text as "collector" | "site_manager" | "recycler";
          if (["collector", "site_manager", "recycler"].includes(nextRole)) {
            setRole(nextRole);
          }
        }}
        placeholder="collector"
      />
      <Field
        label="Site name or area"
        value={siteName}
        onChangeText={setSiteName}
        placeholder="Nairobi West"
      />
      <Field
        label="How did you hear about Takalex?"
        value={referralSource}
        onChangeText={setReferralSource}
        placeholder="Referral or workplace"
      />
      {error ? <Message tone="error">{error}</Message> : null}
      {status ? <Message>{status}</Message> : null}
      <PrimaryButton
        label="Submit request"
        loading={loading}
        onPress={() => void submit()}
      />
      <PrimaryButton label="Back to home" onPress={() => router.replace("/")} />
    </Screen>
  );
}
