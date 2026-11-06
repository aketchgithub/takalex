import { FunctionsHttpError } from "@supabase/supabase-js";

// What an Edge Function call failed with: the HTTP status and the JSON body's
// "error" and "code" fields when the function answered, or a network failure.
export type FunctionFailure =
  | { kind: "http"; status: number; code: string | null; message: string | null }
  | { kind: "network" };

export async function readFunctionFailure(error: unknown): Promise<FunctionFailure> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const record =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    return {
      kind: "http",
      status: response.status,
      code: typeof record.code === "string" ? record.code : null,
      message: typeof record.error === "string" ? record.error : null,
    };
  }
  // FunctionsFetchError, FunctionsRelayError or anything else: no usable answer.
  return { kind: "network" };
}
