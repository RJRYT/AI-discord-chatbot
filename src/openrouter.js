const API_URL = "https://openrouter.ai/api/v1/chat/completions";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function getNumberEnv(name, fallback) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }

export class OpenRouterError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "OpenRouterError";
    this.status = details.status;
    this.code = details.code;
    this.raw = details.raw;
  }
}

async function requestWithRetry(body) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new OpenRouterError("OPENROUTER_API_KEY is missing.");

  const maxRetries = Math.max(0, getNumberEnv("OPENROUTER_MAX_RETRIES", 4));
  const baseDelay = Math.max(250, getNumberEnv("OPENROUTER_RETRY_BASE_MS", 1200));
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
      if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
      if (process.env.OPENROUTER_SITE_NAME) headers["X-Title"] = process.env.OPENROUTER_SITE_NAME;

      const response = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify(body) });
      const rawText = await response.text();
      let data;
      try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
      if (response.ok) return data;

      const apiMessage = data?.error?.message || data?.message || rawText || `HTTP ${response.status}`;
      const retryable = [408, 409, 425, 429].includes(response.status) || response.status >= 500;
      lastError = new OpenRouterError(`OpenRouter ${response.status}: ${apiMessage}`, {
        status: response.status, code: data?.error?.code, raw: data
      });
      if (!retryable || attempt >= maxRetries) throw lastError;

      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
      const delay = Number.isFinite(retryAfterMs) ? Math.min(retryAfterMs, 30000) : Math.min(baseDelay * 2 ** attempt, 15000);
      console.warn(`[OpenRouter] ${response.status}; retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await sleep(delay);
    } catch (error) {
      lastError = error instanceof OpenRouterError ? error : new OpenRouterError(`OpenRouter network error: ${error?.message || String(error)}`);
      if (attempt >= maxRetries) throw lastError;
      const delay = Math.min(baseDelay * 2 ** attempt, 15000);
      console.warn(`[OpenRouter] network retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError || new OpenRouterError("OpenRouter request failed.");
}

function buildServerTools() {
  const tools = [];

  if (String(process.env.OPENROUTER_WEB_SEARCH || "true").toLowerCase() === "true") {
    const tool = { type: "openrouter:web_search" };
    const parameters = {};
    const engine = process.env.OPENROUTER_WEB_SEARCH_ENGINE?.trim();
    const mode = process.env.OPENROUTER_WEB_SEARCH_MODE?.trim();
    if (engine) parameters.engine = engine;
    if (mode) parameters.mode = mode;
    if (Object.keys(parameters).length) tool.parameters = parameters;
    tools.push(tool);
  }

  if (String(process.env.OPENROUTER_WEB_FETCH || "true").toLowerCase() === "true") {
    const tool = { type: "openrouter:web_fetch" };
    const parameters = {};
    const engine = process.env.OPENROUTER_WEB_FETCH_ENGINE?.trim();
    const maxContentTokens = Number(process.env.OPENROUTER_WEB_FETCH_MAX_CONTENT_TOKENS);
    if (engine) parameters.engine = engine;
    if (Number.isFinite(maxContentTokens) && maxContentTokens > 0) parameters.max_content_tokens = maxContentTokens;
    if (Object.keys(parameters).length) tool.parameters = parameters;
    tools.push(tool);
  }

  if (String(process.env.OPENROUTER_DATETIME || "true").toLowerCase() === "true") {
    tools.push({ type: "openrouter:datetime", parameters: { timezone: process.env.OPENROUTER_TIMEZONE || "Asia/Kolkata" } });
  }

  return tools;
}

export function getEnabledServerTools() { return buildServerTools(); }

export async function createChatCompletion({ messages, tools = [], includeServerTools = true, temperature = 0.7, maxTokens = 1800 }) {
  const body = {
    model: process.env.OPENROUTER_MODEL || "nvidia/nemotron-nano-8b-v2",
    messages,
    temperature,
    max_tokens: maxTokens
  };

  const allTools = [...(includeServerTools ? buildServerTools() : []), ...tools];
  if (allTools.length) {
    body.tools = allTools;
    body.tool_choice = "auto";
  }

  return requestWithRetry(body);
}
