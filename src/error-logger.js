import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = 'logs';
const ERROR_LOG_FILE = join(LOG_DIR, 'errors.log');

mkdirSync(LOG_DIR, { recursive: true });

const errorStream = createWriteStream(ERROR_LOG_FILE, { flags: 'a' });

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  white: '\x1b[37m',
};

function formatTime() {
  const now = new Date();
  return now.toISOString();
}

function formatTimeDisplay() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/nvapi-[A-Za-z0-9_-]+/gi, '[api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .trim();
}

function toFileLine(level, scope, message, meta = {}) {
  const payload = {
    timestamp: formatTime(),
    level,
    scope,
    message: cleanText(message),
    ...meta,
  };
  return JSON.stringify(payload);
}

/**
 * Log an error to both the error log file and the console.
 * @param {string} scope - Component or module name
 * @param {Error|unknown} error - The error object
 * @param {object} metadata - Additional context to attach
 */
export function logError(scope, error, metadata = {}) {
  const err = error || new Error('Unknown error');
  const timeDisplay = formatTimeDisplay();
  const message = cleanText(err.message);

  const meta = {
    name: err.name,
    message,
    stack: err.stack,
    code: err.code,
    status: err.status,
    ...metadata,
  };

  // Write structured line to error log file
  errorStream.write(toFileLine('ERROR', scope, message, meta) + '\n');

  // Pretty console output
  console.error(
    `${colors.dim}[${timeDisplay}]${colors.reset} ` +
      `${colors.red}${colors.bright}[ERROR]${colors.reset} ` +
      `${colors.white}[${scope}]${colors.reset} ` +
      `${colors.red}${message}${colors.reset}`,
  );

  if (err.stack) {
    console.error(`${colors.dim}  Stack:${colors.reset}\n${colors.red}${err.stack}${colors.reset}`);
  }

  const metaKeys = Object.keys(metadata).filter(
    (k) => k !== 'name' && k !== 'message' && k !== 'stack' && k !== 'code' && k !== 'status',
  );
  if (metaKeys.length) {
    console.error(
      `${colors.dim}  Context:${colors.reset}\n${colors.dim}${JSON.stringify(metadata, null, 2)}${colors.reset}`,
    );
  }
}

/**
 * Log a warning to both the error log file and the console.
 * @param {string} scope - Component or module name
 * @param {string} message - Warning message
 * @param {object} metadata - Additional context to attach
 */
export function logWarning(scope, message, metadata = {}) {
  const timeDisplay = formatTimeDisplay();
  const cleanMsg = cleanText(message);

  const meta = {
    message: cleanMsg,
    ...metadata,
  };

  errorStream.write(toFileLine('WARN', scope, cleanMsg, meta) + '\n');

  console.warn(
    `${colors.dim}[${timeDisplay}]${colors.reset} ` +
      `${colors.yellow}${colors.bright}[WARN]${colors.reset} ` +
      `${colors.white}[${scope}]${colors.reset} ` +
      `${colors.yellow}${cleanMsg}${colors.reset}`,
  );

  if (Object.keys(metadata).length) {
    console.warn(
      `${colors.dim}  Context:${colors.reset}\n${colors.dim}${JSON.stringify(metadata, null, 2)}${colors.reset}`,
    );
  }
}

/**
 * Close the error log stream (call on shutdown).
 */
export function closeErrorLog() {
  return new Promise((resolve) => errorStream.end(resolve));
}
