type FailureSource = "news-label-group-1" | "news-label-group-6" | "news" | "options";
type BodyType = "empty" | "JSON" | "HTML" | "other";

function safeHeader(response: Response, name: string): string | null {
  const value = response.headers.get(name);
  if (value === null) return null;
  if (
    value.length > 160 || /[\x00-\x1f\x7f]/.test(value) ||
    /cookie|authorization|bearer|token|secret|password|session|clearance|eyJ[\w-]+\./i.test(value)
  ) return "[redacted]";
  return value;
}

async function failureBodyType(response: Response): Promise<BodyType> {
  if (!response.body) return "empty";
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Bound diagnostic work; response text is never included in a log.
    return await Promise.race([
      (async (): Promise<BodyType> => {
        const decoder = new TextDecoder();
        let prefix = "";
        let bytes = 0;
        while (bytes < 4096) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = value.subarray(0, 4096 - bytes);
          bytes += chunk.byteLength;
          prefix += decoder.decode(chunk, { stream: true });
        }
        if (bytes === 0) return "empty";
        prefix += decoder.decode();
        const contentType = response.headers.get("content-type") ?? "";
        if (/^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(prefix)) return "HTML";
        try {
          JSON.parse(prefix);
          return "JSON";
        } catch {
          if (/\b(?:application|text)\/(?:[\w.-]+\+)?json\b/i.test(contentType)) return "JSON";
          if (/\btext\/html\b/i.test(contentType)) return "HTML";
          return "other";
        }
      })(),
      new Promise<BodyType>((resolve) => {
        timer = setTimeout(() => resolve("other"), 250);
      }),
    ]);
  } catch {
    return "other";
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export async function logUpstreamFailure(source: FailureSource, response: Response): Promise<void> {
  try {
    console.error("Upstream HTTP failure", JSON.stringify({
      source,
      status: response.status,
      server: safeHeader(response, "server"),
      "content-type": safeHeader(response, "content-type"),
      "cf-ray": safeHeader(response, "cf-ray"),
      bodyType: await failureBodyType(response),
    }));
  } catch {
    // Diagnostics must never replace the caller's existing failure behavior.
  }
}
