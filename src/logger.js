// ANSI color codes (no dependency)
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
};

const ASCII_BANNER = `
${colors.green}${colors.bright}  NVIDIA Nemotron Discord AI Admin Bot${colors.reset}
${colors.dim}  Powered by NVIDIA Nemotron API • discord.js v14${colors.reset}
`;

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function levelColor(level) {
  switch (level) {
    case "error": return colors.red;
    case "warn": return colors.yellow;
    case "success": return colors.green;
    case "info": return colors.blue;
    case "debug": return colors.magenta;
    default: return colors.white;
  }
}

function levelIcon(level) {
  switch (level) {
    case "error": return "❌";
    case "warn": return "⚠️ ";
    case "success": return "✅";
    case "info": return "ℹ️ ";
    case "debug": return "🐛";
    default: return "•";
  }
}

function log(level, scope, message, meta = {}) {
  const color = levelColor(level);
  const icon = levelIcon(level);
  const timestamp = `${colors.dim}[${formatTime()}]${colors.reset}`;
  const levelTag = `${color}${colors.bright}[${level.toUpperCase()}]${colors.reset}`;
  const scopeTag = `${colors.cyan}[${scope}]${colors.reset}`;

  let output = `${timestamp} ${levelTag} ${scopeTag} ${icon} ${message}`;

  if (meta && Object.keys(meta).length) {
    output += `\n${colors.dim}  ${JSON.stringify(meta, null, 2)}${colors.reset}`;
  }

  console.log(output);
}

export function info(scope, message, meta) {
  log("info", scope, message, meta);
}

export function success(scope, message, meta) {
  log("success", scope, message, meta);
}

export function warn(scope, message, meta) {
  log("warn", scope, message, meta);
}

export function error(scope, message, meta = {}) {
  const color = colors.red;
  const icon = levelIcon("error");
  const timestamp = `${colors.dim}[${formatTime()}]${colors.reset}`;
  const levelTag = `${color}${colors.bright}[ERROR]${colors.reset}`;
  const scopeTag = `${colors.cyan}[${scope}]${colors.reset}`;

  let output = `${timestamp} ${levelTag} ${scopeTag} ${icon} ${message}`;

  if (meta && Object.keys(meta).length) {
    output += `\n${colors.dim}  ${JSON.stringify(meta, null, 2)}${colors.reset}`;
  }

  if (meta.error instanceof Error) {
    output += `\n${colors.red}  Stack: ${meta.error.stack}${colors.reset}`;
  } else if (meta.stack) {
    output += `\n${colors.red}  Stack: ${meta.stack}${colors.reset}`;
  }

  console.error(output);
}

export function fatal(scope, message, meta = {}) {
  error(scope, message, meta);
  process.exitCode = 1;
}

export function printBanner() {
  console.log(ASCII_BANNER);
}

export function printSection(title) {
  const border = "═".repeat(title.length + 4);
  console.log(`\n${colors.bright}${colors.blue}${border}${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}  ${title}${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}${border}${colors.reset}\n`);
}

export function printKeyValue(key, value) {
  console.log(`  ${colors.dim}${colors.cyan}${key}:${colors.reset} ${colors.white}${value}${colors.reset}`);
}
