const API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function getNumberEnv(name, fallback) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }

export class NVIDIAError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "NVIDIAError";
    this.status = details.status;
    this.code = details.code;
    this.raw = details.raw;
  }
}

async function requestWithRetry(body) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new NVIDIAError("NVIDIA_API_KEY is missing.");

  const maxRetries = Math.max(0, getNumberEnv("NVIDIA_MAX_RETRIES", 4));
  const baseDelay = Math.max(250, getNumberEnv("NVIDIA_RETRY_BASE_MS", 1200));
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };

      const response = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify(body) });
      const rawText = await response.text();
      let data;
      try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
      if (response.ok) return data;

      const apiMessage = data?.error?.message || data?.message || rawText || `HTTP ${response.status}`;
      const retryable = [408, 409, 425, 429].includes(response.status) || response.status >= 500;
      lastError = new NVIDIAError(`NVIDIA ${response.status}: ${apiMessage}`, {
        status: response.status, code: data?.error?.code, raw: data
      });
      if (!retryable || attempt >= maxRetries) throw lastError;

      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
      const delay = Number.isFinite(retryAfterMs) ? Math.min(retryAfterMs, 30000) : Math.min(baseDelay * 2 ** attempt, 15000);
      console.warn(`[NVIDIA] ${response.status}; retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await sleep(delay);
    } catch (error) {
      lastError = error instanceof NVIDIAError ? error : new NVIDIAError(`NVIDIA network error: ${error?.message || String(error)}`);
      if (attempt >= maxRetries) throw lastError;
      const delay = Math.min(baseDelay * 2 ** attempt, 15000);
      console.warn(`[NVIDIA] network retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError || new NVIDIAError("NVIDIA request failed.");
}

export async function createChatCompletion({ messages, tools = [], includeServerTools = true, temperature = 0.7, maxTokens = 1800 }) {
  const body = {
    model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3.5-super-vl-120b-a12b",
    messages,
    temperature,
    max_tokens: maxTokens
  };

  const allTools = [...(includeServerTools ? getEnabledServerTools() : []), ...tools];
  if (allTools.length) {
    body.tools = allTools;
    body.tool_choice = "auto";
  }

  return requestWithRetry(body);
}