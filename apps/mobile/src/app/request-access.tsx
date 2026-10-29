import { useState } from "react";
import { router } from "expo-router";
import { z } from "zod";

import { Field, Message, PrimaryButton, Screen } from "@/components/Ui";
import { submitAccessRequest } from "@/lib/access";

const requestSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  phone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "Use an international phone number, for example +254712345678.").optional().or(z.literal("")),
  role: z.enum(["collector", "admin", "recycler"]).default("collector"),
  site_name: z.string().trim().max(120, "Site name is too long.").optional().or(z.literal("")),
  referral_source: z.string().trim().max(200, "Referral source is too long.").optional().or(z.literal("")),
});

export default function RequestAccessScreen() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"collector" | "admin" | "recycler">("collector");
  const [siteName, setSiteName] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const parsed = requestSchema.safeParse({
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

    if (!parsed.data.email && !parsed.data.phone) {
      setError("Provide either an email address or a phone number.");
      setStatus(null);
      return;
    }

    setLoading(true);
    setError(null);
    setStatus(null);

    const { data, error: submitError } = await submitAccessRequest(parsed.data);

    setLoading(false);

    if (submitError) {
      setError(submitError.message);
      return;
    }

    setStatus(
      data
        ? "Your request has been submitted. An administrator will review it and send an invite if approved."
        : "Your request has been submitted. An administrator will review it shortly.",
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
          const nextRole = text as "collector" | "admin" | "recycler";
          if (["collector", "admin", "recycler"].includes(nextRole)) {
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
