const DISCORD_MESSAGES = new Map([
  [10003, 'That Discord channel no longer exists or I cannot access it.'],
  [10007, 'That Discord member could not be found in this server.'],
  [10008, 'That Discord message no longer exists or I cannot access it.'],
  [10011, 'That Discord role could not be found.'],
  [10013, 'That Discord user is not available for this operation.'],
  [50001, 'I do not have access to that Discord resource.'],
  [50013, 'Discord denied this action because I am missing the required permission.'],
  [50035, 'Discord rejected the request because one or more values are invalid.'],
  [50007, 'I cannot send a direct message to that user.'],
  [30013, 'That Discord server has reached the relevant limit for this resource.'],
]);

function cleanText(value) {
  return String(value ?? '')
    .replace(/https:\/\/discord(?:\.gg|\.com\/invite)\/[A-Za-z0-9_-]+/gi, '[invite-url]')
    .replace(/nvapi-[A-Za-z0-9_-]+/gi, '[api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .trim();
}

export function humanizeError(error, fallback = 'Something went wrong.') {
  if (!error) return fallback;

  const code = Number(error?.code);
  const status = Number(error?.status ?? error?.statusCode);

  if (DISCORD_MESSAGES.has(code)) {
    return `Discord: ${DISCORD_MESSAGES.get(code)}`;
  }

  if (status === 429 || /rate.?limit/i.test(String(error?.message || ''))) {
    const retryAfter = Number(error?.retryAfter);
    return Number.isFinite(retryAfter)
      ? `Discord/NVIDIA rate limit reached. Please try again in ${Math.ceil(retryAfter)} seconds.`
      : 'Rate limit reached. Please try again in a moment.';
  }

  if (error?.name === 'AbortError' || /timed? ?out|timeout/i.test(String(error?.message || ''))) {
    return 'The AI request timed out before a response was received.';
  }

  if (error?.name === 'NVIDIAError' && error?.message) {
    return cleanText(error.message);
  }

  if (error?.name === 'TypeError' && /fetch failed|network/i.test(String(error?.message || ''))) {
    return 'I could not reach the AI service. Please try again in a moment.';
  }

  const message = cleanText(error?.userMessage || error?.message);
  return message || fallback;
}

export function logError(scope, error, metadata = {}) {
  const payload = {
    ...metadata,
    name: error?.name,
    code: error?.code,
    status: error?.status,
    message: cleanText(error?.message),
    stack: error?.stack,
  };
  console.error(`[${scope}]`, payload);
}
