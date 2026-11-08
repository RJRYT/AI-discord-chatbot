import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const FILE = path.join(DATA_DIR, "permissions.json");

const DEFAULT_DATA = { guilds: {} };

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(FILE); }
  catch { await fs.writeFile(FILE, JSON.stringify(DEFAULT_DATA, null, 2), "utf8"); }
}

export async function loadPermissions() {
  await ensureFile();
  try {
    const data = JSON.parse(await fs.readFile(FILE, "utf8"));
    if (!data.guilds || typeof data.guilds !== "object") data.guilds = {};
    for (const guild of Object.values(data.guilds)) {
      if (!Array.isArray(guild.admins)) guild.admins = [];
      if (!Array.isArray(guild.autochatChannels)) guild.autochatChannels = [];
    }
    return data;
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

export async function savePermissions(data) {
  await ensureFile();
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export function getGuildConfig(data, guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = { admins: [], autochatChannels: [] };
  }
  const guild = data.guilds[guildId];
  if (!Array.isArray(guild.admins)) guild.admins = [];
  if (!Array.isArray(guild.autochatChannels)) guild.autochatChannels = [];
  return guild;
}

export function getGuildAdmins(data, guildId) {
  return getGuildConfig(data, guildId).admins;
}

export function isAdmin(data, guildId, userId) {
  return getGuildAdmins(data, guildId).includes(userId);
}

export async function addAdmin(data, guildId, userId) {
  const admins = getGuildAdmins(data, guildId);
  if (!admins.includes(userId)) admins.push(userId);
  await savePermissions(data);
}

export async function removeAdmin(data, guildId, userId) {
  const admins = getGuildAdmins(data, guildId);
  data.guilds[guildId].admins = admins.filter((id) => id !== userId);
  await savePermissions(data);
}

export function isAutochatEnabled(data, guildId, channelId) {
  return getGuildConfig(data, guildId).autochatChannels.includes(channelId);
}

export async function enableAutochat(data, guildId, channelId) {
  const channels = getGuildConfig(data, guildId).autochatChannels;
  if (!channels.includes(channelId)) channels.push(channelId);
  await savePermissions(data);
}

export async function disableAutochat(data, guildId, channelId) {
  const config = getGuildConfig(data, guildId);
  config.autochatChannels = config.autochatChannels.filter((id) => id !== channelId);
  await savePermissions(data);
}

export function getAutochatChannels(data, guildId) {
  return getGuildConfig(data, guildId).autochatChannels;
}
