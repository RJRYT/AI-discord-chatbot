import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField
} from "discord.js";

import crypto from "node:crypto";

import { extractSnowflake, normalizeChannelName, splitForDiscord } from "./discord-utils.js";
import { addAdmin, getGuildAdmins, removeAdmin } from "./storage.js";

export const DANGEROUS_TOOLS = new Set([
  "delete_channel",
  "lock_channel",
  "unlock_channel",
  "update_channel_permissions",
  "allow_user_in_channel",
  "deny_user_in_channel",
  "remove_user_channel_override",
  "allow_role_in_channel",
  "deny_role_in_channel",
  "remove_role_channel_override",
  "create_role",
  "delete_role",
  "edit_role",
  "update_role_permissions",
  "add_role_to_user",
  "remove_role_from_user",
  "kick_user",
  "ban_user",
  "unban_user",
  "timeout_user",
  "remove_timeout",
  "mute_user",
  "unmute_user",
  "delete_message",
  "bulk_delete_messages",
  "create_invite",
  "delete_invite"
]);

const CHANNEL_TYPES = {
  text: ChannelType.GuildText,
  announcement: ChannelType.GuildAnnouncement,
  voice: ChannelType.GuildVoice,
  stage: ChannelType.GuildStageVoice,
  category: ChannelType.GuildCategory,
  forum: ChannelType.GuildForum,
  media: ChannelType.GuildMedia
};

const PERMISSION_ALIASES = {
  view: "ViewChannel",
  view_channel: "ViewChannel",
  send: "SendMessages",
  send_messages: "SendMessages",
  read: "ReadMessageHistory",
  read_messages: "ReadMessageHistory",
  manage_message: "ManageMessages",
  manage_messages: "ManageMessages",
  manage_channel: "ManageChannels",
  manage_channels: "ManageChannels",
  manage_roles: "ManageRoles",
  administrator: "Administrator",
  embed_links: "EmbedLinks",
  attach_files: "AttachFiles",
  add_reactions: "AddReactions",
  mention_everyone: "MentionEveryone",
  connect: "Connect",
  speak: "Speak",
  mute_members: "MuteMembers",
  deafen_members: "DeafenMembers",
  move_members: "MoveMembers",
  use_voice_activation: "UseVAD",
  use_vad: "UseVAD",
  moderate_members: "ModerateMembers",
  kick_members: "KickMembers",
  ban_members: "BanMembers",
  manage_webhooks: "ManageWebhooks",
  manage_events: "ManageEvents",
  create_public_threads: "CreatePublicThreads",
  create_private_threads: "CreatePrivateThreads",
  send_messages_in_threads: "SendMessagesInThreads",
  manage_threads: "ManageThreads",
  use_application_commands: "UseApplicationCommands",
  use_external_emojis: "UseExternalEmojis",
  use_external_stickers: "UseExternalStickers",
  priority_speaker: "PrioritySpeaker",
  stream: "Stream",
  request_to_speak: "RequestToSpeak",
  manage_nicknames: "ManageNicknames"
};

const permissionNames = new Map(
  Object.keys(PermissionFlagsBits).map((name) => [
    name.toLowerCase(),
    name
  ])
);

export const TOOL_ALIASES = {
  server_info: "get_server_info",
  list_channels: "get_channels",
  member_info: "get_user_info",
  search_members: "list_members",
  channel_info: "get_channel_info",
  role_info: "get_role_info",
  set_channel_permission: "update_channel_permissions",
  set_role_permissions: "update_role_permissions",
  add_role: "add_role_to_user",
  remove_role: "remove_role_from_user",
  set_nickname: "change_nickname",
  kick_member: "kick_user",
  ban_member: "ban_user",
  unban_member: "unban_user",
  timeout_member: "timeout_user",
  mute_member: "mute_user",
  unmute_member: "unmute_user",
  delete_messages: "bulk_delete_messages",
  grant_ai_admin: "grant_admin",
  revoke_ai_admin: "revoke_admin",
  list_ai_admins: "list_admins"
};

export const TOOL_ADMIN = new Set([
  "create_channel","edit_channel","delete_channel","move_channel","create_category","edit_category","delete_category",
  "lock_channel","unlock_channel","set_channel_slowmode","set_channel_permission",
  "create_role","delete_role","edit_role","update_role_permissions","add_role","remove_role",
  "set_nickname","kick_member","ban_member","unban_member","timeout_member","remove_timeout","mute_member","unmute_member",
  "send_message","send_embed_message","edit_message","delete_message","delete_messages","pin_message","unpin_message",
  "create_thread","archive_thread","add_reaction","remove_reaction","get_audit_logs","create_invite","delete_invite",
  "move_member_voice","disconnect_member_voice","deafen_member","undeafen_member"
]);

export const TOOL_OWNER = new Set([
  "grant_ai_admin","revoke_ai_admin","list_ai_admins"
]);

function stringProp() { return { type: "string" }; }
function integerProp(minimum, maximum) { return { type: "integer", ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) }; }
function boolProp() { return { type: "boolean" }; }
function arrayProp(items = { type: "string" }) { return { type: "array", items }; }

function normalizePermissionName(value) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    throw new Error("Permission name cannot be empty.");
  }

  const alias = PERMISSION_ALIASES[raw.toLowerCase()];

  if (alias) {
    return alias;
  }

  const exact = permissionNames.get(raw.toLowerCase());

  if (exact) {
    return exact;
  }

  throw new Error(`Unknown Discord permission: ${raw}`);
}

function permissionBitfield(names = []) {
  const bits = names.map((name) => {
    const normalized = normalizePermissionName(name);
    return PermissionFlagsBits[normalized];
  });

  return new PermissionsBitField(bits);
}

function getTextChannel(guild, channelId, fallbackId) {
  const id = extractSnowflake(channelId) || fallbackId;
  const channel = guild.channels.cache.get(id);

  if (!channel) {
    throw new Error(`Channel ${id} was not found.`);
  }

  return channel;
}

async function getMember(guild, value) {
  const id = extractSnowflake(value);

  if (!id) {
    throw new Error("A valid Discord user ID or mention is required.");
  }

  try {
    return await guild.members.fetch(id);
  } catch {
    throw new Error(`User ${id} was not found in this server.`);
  }
}

function getRole(guild, value) {
  const id = extractSnowflake(value);
  if (!id) throw new Error("A valid Discord role ID or mention is required.");

  const role = guild.roles.cache.get(id);
  if (!role) throw new Error(`Role ${id} was not found.`);
  return role;
}

function requireManageableRole(guild, role) {
  if (role.id === guild.id) {
    throw new Error("The @everyone role cannot be modified this way.");
  }

  if (role.managed) {
    throw new Error("Managed/integration roles cannot be modified.");
  }

  if (!role.editable) {
    throw new Error("My highest role is not above this role.");
  }
}

function requireModeratableMember(guild, member) {
  if (member.id === process.env.OWNER_USER_ID) {
    throw new Error("The configured owner cannot be moderated.");
  }

  if (member.id === guild.client.user?.id) {
    throw new Error("I cannot moderate myself.");
  }

  if (!member.manageable) {
    throw new Error(
      "Discord role hierarchy prevents me from managing this user."
    );
  }
}

function channelSummary(channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: channel.position,
    url: channel.url,
    topic: "topic" in channel ? channel.topic : null,
    nsfw: "nsfw" in channel ? channel.nsfw : null,
    slowmode:
      "rateLimitPerUser" in channel
        ? channel.rateLimitPerUser
        : null,
    manageable:
      "manageable" in channel ? channel.manageable : null
  };
}

function roleSummary(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    position: role.position,
    permissions: role.permissions.toArray()
  };
}

function baseTool(name, description, properties = {}, required = []) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false
      }
    }
  };
}

export function createToolDeclarations({ canAdmin, canGrantAdmin }) {
  const tools = [];

  if (canAdmin) {
    tools.push(
      baseTool(
        "create_channel",
        "Create a Discord channel. Defaults to a normal text channel. Supported types: text, announcement, voice, stage, category, forum, media.",
        {
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["text", "announcement", "voice", "stage", "category", "forum", "media"]
          },
          parent_id: { type: "string" },
          topic: { type: "string" },
          nsfw: { type: "boolean" },
          slowmode: { type: "integer", minimum: 0, maximum: 21600 },
          sync_permissions: { type: "boolean" }
        },
        ["name"]
      ),

      baseTool(
        "delete_channel",
        "Permanently delete a Discord channel.",
        { channel_id: { type: "string" } }
      ),

      baseTool(
        "edit_channel",
        "Edit a Discord channel's name, topic, NSFW status, slowmode, parent category, or position.",
        {
          channel_id: { type: "string" },
          name: { type: "string" },
          topic: { type: "string" },
          nsfw: { type: "boolean" },
          slowmode: { type: "integer", minimum: 0, maximum: 21600 },
          parent_id: { type: "string" },
          position: { type: "integer", minimum: 0 },
          sync_permissions: { type: "boolean" }
        },
        []
      ),

      baseTool(
        "move_channel",
        "Move a channel to a different position and optionally another category.",
        {
          channel_id: { type: "string" },
          position: { type: "integer", minimum: 0 },
          parent_id: { type: "string" },
          sync_permissions: { type: "boolean" }
        },
        ["position"]
      ),

      baseTool(
        "lock_channel",
        "Prevent @everyone from sending messages in a text channel.",
        { channel_id: { type: "string" } }
      ),

      baseTool(
        "unlock_channel",
        "Remove the explicit @everyone SendMessages denial from a text channel.",
        { channel_id: { type: "string" } }
      ),

      baseTool(
        "set_channel_slowmode",
        "Set text-channel slowmode in seconds.",
        {
          channel_id: { type: "string" },
          seconds: { type: "integer", minimum: 0, maximum: 21600 }
        },
        ["seconds"]
      ),

      baseTool(
        "get_channels",
        "List server channels with IDs, names, positions, and parent categories."
      ),

      baseTool(
        "get_channel_info",
        "Get detailed information about a Discord channel.",
        { channel_id: { type: "string" } }
      ),

      baseTool(
        "update_channel_permissions",
        "Update a user or role channel permission overwrite. Use clear=true to remove the entire override.",
        {
          channel_id: { type: "string" },
          target_type: { type: "string", enum: ["user", "role"] },
          target_id: { type: "string" },
          allow: { type: "array", items: { type: "string" } },
          deny: { type: "array", items: { type: "string" } },
          clear: { type: "boolean" }
        },
        ["target_type", "target_id"]
      ),

      baseTool(
        "allow_user_in_channel",
        "Allow a user to view a channel.",
        {
          channel_id: { type: "string" },
          user_id: { type: "string" }
        },
        ["user_id"]
      ),

      baseTool(
        "deny_user_in_channel",
        "Deny a user from viewing a channel.",
        {
          channel_id: { type: "string" },
          user_id: { type: "string" }
        },
        ["user_id"]
      ),

      baseTool(
        "remove_user_channel_override",
        "Remove a user's channel permission override.",
        {
          channel_id: { type: "string" },
          user_id: { type: "string" }
        },
        ["user_id"]
      ),

      baseTool(
        "allow_role_in_channel",
        "Allow a role to view a channel.",
        {
          channel_id: { type: "string" },
          role_id: { type: "string" }
        },
        ["role_id"]
      ),

      baseTool(
        "deny_role_in_channel",
        "Deny a role from viewing a channel.",
        {
          channel_id: { type: "string" },
          role_id: { type: "string" }
        },
        ["role_id"]
      ),

      baseTool(
        "remove_role_channel_override",
        "Remove a role's channel permission override.",
        {
          channel_id: { type: "string" },
          role_id: { type: "string" }
        },
        ["role_id"]
      ),

      baseTool(
        "create_role",
        "Create a Discord role. Defaults to no special permissions.",
        {
          name: { type: "string" },
          color: { type: "string" },
          hoist: { type: "boolean" },
          mentionable: { type: "boolean" },
          permissions: { type: "array", items: { type: "string" } }
        },
        ["name"]
      ),

      baseTool(
        "delete_role",
        "Delete a Discord role.",
        { role_id: { type: "string" } },
        ["role_id"]
      ),

      baseTool(
        "edit_role",
        "Edit a Discord role's name, color, hoist, mentionability, or position.",
        {
          role_id: { type: "string" },
          name: { type: "string" },
          color: { type: "string" },
          hoist: { type: "boolean" },
          mentionable: { type: "boolean" },
          position: { type: "integer", minimum: 1 }
        },
        ["role_id"]
      ),

      baseTool(
        "update_role_permissions",
        "Add, remove, or replace a role's base permissions.",
        {
          role_id: { type: "string" },
          mode: { type: "string", enum: ["add", "remove", "replace"] },
          permissions: { type: "array", items: { type: "string" } }
        },
        ["role_id", "mode", "permissions"]
      ),

      baseTool(
        "add_role_to_user",
        "Add a Discord role to a member.",
        {
          user_id: { type: "string" },
          role_id: { type: "string" }
        },
        ["user_id", "role_id"]
      ),

      baseTool(
        "remove_role_from_user",
        "Remove a Discord role from a member.",
        {
          user_id: { type: "string" },
          role_id: { type: "string" }
        },
        ["user_id", "role_id"]
      ),

      baseTool("list_roles", "List server roles with IDs and permissions."),

      baseTool(
        "get_role_info",
        "Get detailed information about a Discord role.",
        { role_id: { type: "string" } },
        ["role_id"]
      ),

      baseTool(
        "get_user_info",
        "Get detailed information about a server member.",
        { user_id: { type: "string" } },
        ["user_id"]
      ),

      baseTool(
        "list_members",
        "Search cached guild members by username, display name, or nickname.",
        {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
          include_bots: { type: "boolean" }
        }
      ),

      baseTool(
        "change_nickname",
        "Change or remove a member's server nickname. Empty nickname removes it.",
        {
          user_id: { type: "string" },
          nickname: { type: "string" }
        },
        ["user_id"]
      ),

      baseTool(
        "kick_user",
        "Kick a member from the server.",
        {
          user_id: { type: "string" },
          reason: { type: "string" }
        },
        ["user_id"]
      ),

      baseTool(
        "ban_user",
        "Ban a member from the server.",
        {
          user_id: { type: "string" },
          reason: { type: "string" },
          delete_message_days: {
            type: "integer",
            minimum: 0,
            maximum: 7
          }
        },
        ["user_id"]
      ),

      baseTool(
        "unban_user",
        "Unban a user by Discord user ID.",
        {
          user_id: { type: "string" },
          reason: { type: "string" }
        },
        ["user_id"]
      ),

      baseTool(
        "timeout_user",
        "Timeout a member for up to 28 days.",
        {
          user_id: { type: "string" },
          duration_seconds: {
            type: "integer",
            minimum: 1,
            maximum: 2419200
          },
          reason: { type: "string" }
        },
        ["user_id", "duration_seconds"]
      ),

      baseTool(
        "remove_timeout",
        "Remove a timeout from a member.",
        {
          user_id: { type: "string" },
          reason: { type: "string" }
        },
        ["user_id"]
      ),

      baseTool(
        "mute_user",
        "Server-mute a member in their current voice channel.",
        {
          user_id: { type: "string" },
          reason: { type: "string" }
        },
        ["user_id"]
      ),

      baseTool(
        "unmute_user",
        "Remove server mute from a member.",
        {
          user_id: { type: "string" },
          reason: { type: "string" }
        },
        ["user_id"]
      ),

      baseTool(
        "delete_message",
        "Delete one Discord message.",
        {
          channel_id: { type: "string" },
          message_id: { type: "string" }
        },
        ["message_id"]
      ),

      baseTool(
        "bulk_delete_messages",
        "Bulk delete 2-100 recent messages.",
        {
          channel_id: { type: "string" },
          count: { type: "integer", minimum: 2, maximum: 100 }
        },
        ["count"]
      ),

      baseTool(
        "pin_message",
        "Pin a message.",
        {
          channel_id: { type: "string" },
          message_id: { type: "string" }
        },
        ["message_id"]
      ),

      baseTool(
        "unpin_message",
        "Unpin a message.",
        {
          channel_id: { type: "string" },
          message_id: { type: "string" }
        },
        ["message_id"]
      ),

      baseTool(
        "get_server_info",
        "Get basic Discord server information."
      ),

      baseTool(
        "get_audit_logs",
        "Read recent Discord audit-log entries. Requires the bot to have ViewAuditLog.",
        {
          limit: { type: "integer", minimum: 1, maximum: 20 }
        }
      ),

      baseTool(
        "create_invite",
        "Create a Discord invite for a channel.",
        {
          channel_id: { type: "string" },
          max_age_seconds: { type: "integer", minimum: 0, maximum: 604800 },
          max_uses: { type: "integer", minimum: 0, maximum: 100 },
          temporary: { type: "boolean" },
          unique: { type: "boolean" }
        }
      ),

      baseTool(
        "delete_invite",
        "Delete a Discord invite by its invite code or full URL.",
        { code: { type: "string" } },
        ["code"]
      ),

      baseTool(
        "create_category",
        "Create a Discord channel category.",
        { name: { type: "string" } },
        ["name"]
      ),

      baseTool(
        "edit_category",
        "Edit a category name or position.",
        { category_id: { type: "string" }, name: { type: "string" }, position: { type: "integer", minimum: 1 } },
        ["category_id"]
      ),

      baseTool(
        "delete_category",
        "Delete a Discord channel category.",
        { category_id: { type: "string" } },
        ["category_id"]
      ),

      baseTool(
        "send_message",
        "Send a normal Discord message. The implementation automatically splits content that exceeds Discord's 2000-character limit.",
        { channel_id: { type: "string" }, content: { type: "string" }, reply_to_message_id: { type: "string" } },
        ["content"]
      ),

      baseTool(
        "send_embed_message",
        "Send one or more Discord embeds. The implementation enforces Discord's embed limits and splits oversized content safely.",
        { channel_id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, url: { type: "string" }, color: { type: "string" }, fields: { type: "array", items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" }, inline: { type: "boolean" } }, required: ["name", "value"], additionalProperties: false } }, footer: { type: "string" }, timestamp: { type: "boolean" } },
        ["description"]
      ),

      baseTool(
        "edit_message",
        "Edit a message previously sent by this bot. Message content must be <= 2000 characters.",
        { channel_id: { type: "string" }, message_id: { type: "string" }, content: { type: "string" } },
        ["channel_id", "message_id", "content"]
      ),

      baseTool(
        "create_thread",
        "Create a thread, optionally attached to a message.",
        { channel_id: { type: "string" }, name: { type: "string" }, message_id: { type: "string" }, auto_archive_minutes: { type: "integer", enum: [60, 1440, 4320, 10080] } },
        ["channel_id", "name"]
      ),

      baseTool(
        "archive_thread",
        "Archive/unarchive and optionally lock/unlock a thread.",
        { channel_id: { type: "string" }, archived: { type: "boolean" }, locked: { type: "boolean" } },
        ["channel_id", "archived"]
      ),

      baseTool(
        "add_reaction",
        "React to a message with a Unicode emoji or custom emoji ID.",
        { channel_id: { type: "string" }, message_id: { type: "string" }, emoji: { type: "string" } },
        ["channel_id", "message_id", "emoji"]
      ),

      baseTool(
        "remove_reaction",
        "Remove the bot's reaction from a message.",
        { channel_id: { type: "string" }, message_id: { type: "string" }, emoji: { type: "string" } },
        ["channel_id", "message_id", "emoji"]
      ),

      baseTool(
        "move_member_voice",
        "Move a member to a voice channel.",
        { user_id: { type: "string" }, channel_id: { type: "string" }, reason: { type: "string" } },
        ["user_id", "channel_id"]
      ),

      baseTool(
        "disconnect_member_voice",
        "Disconnect a member from voice.",
        { user_id: { type: "string" }, reason: { type: "string" } },
        ["user_id"]
      ),

      baseTool(
        "deafen_member",
        "Server-deafen a member in voice.",
        { user_id: { type: "string" }, reason: { type: "string" } },
        ["user_id"]
      ),

      baseTool(
        "undeafen_member",
        "Remove server deafening from a member.",
        { user_id: { type: "string" }, reason: { type: "string" } },
        ["user_id"]
      )
    );
  }

  if (canGrantAdmin) {
    tools.push(
      baseTool(
        "grant_admin",
        "Grant AI administration access to a Discord user. Only RJRYT can do this.",
        { user_id: { type: "string" } },
        ["user_id"]
      ),

      baseTool(
        "revoke_admin",
        "Revoke AI administration access from a Discord user. Only RJRYT can do this.",
        { user_id: { type: "string" } },
        ["user_id"]
      ),

      baseTool(
        "list_admins",
        "List the configured AI administrators."
      )
    );
  }

  if (!canAdmin) {
    tools.push(
      baseTool(
        "dice_roll",
        "Roll dice using standard notation like 1d20, 2d6+3, or 3d8-1.",
        {
          notation: { type: "string", description: "Dice notation (e.g. 1d20, 2d6+3)" },
          modifier: { type: "integer", description: "Additional modifier to add to the total", minimum: -1000, maximum: 1000 }
        },
        ["notation"]
      ),
      baseTool(
        "uuid_generate",
        "Generate a random UUID v4 identifier.",
        {},
        []
      ),
      baseTool(
        "base64_encode",
        "Encode text to Base64.",
        { text: { type: "string", description: "Text to encode" } },
        ["text"]
      ),
      baseTool(
        "base64_decode",
        "Decode Base64 text back to plain text.",
        { encoded: { type: "string", description: "Base64 encoded text to decode" } },
        ["encoded"]
      ),
      baseTool(
        "hash_text",
        "Hash text using SHA-256 or MD5 algorithm.",
        {
          text: { type: "string", description: "Text to hash" },
          algorithm: { type: "string", enum: ["sha256", "md5"], default: "sha256", description: "Hash algorithm to use" }
        },
        ["text"]
      ),
      baseTool(
        "json_format",
        "Validate and pretty-print JSON text.",
        { json: { type: "string", description: "JSON text to format" } },
        ["json"]
      )
    );
  }

  return tools;
}

function makeReason(requester, args) {
  return String(
    args.reason ||
      `Requested by ${requester.username} via NVIDIA Nemotron`
  ).slice(0, 512);
}

function ensureCanUse(canAdmin) {
  if (!canAdmin) {
    throw new Error(
      "The requester is not authorized to use Discord administration tools."
    );
  }
}

export const TOOL_STATUS = {
  create_channel: "Creating channel...",
  delete_channel: "Deleting channel...",
  edit_channel: "Editing channel...",
  move_channel: "Moving channel...",
  lock_channel: "Locking channel...",
  unlock_channel: "Unlocking channel...",
  set_channel_slowmode: "Updating channel slowmode...",
  get_channels: "Reading channels...",
  get_channel_info: "Reading channel information...",
  update_channel_permissions: "Updating channel permissions...",
  allow_user_in_channel: "Allowing user in channel...",
  deny_user_in_channel: "Restricting user in channel...",
  remove_user_channel_override: "Removing user channel override...",
  allow_role_in_channel: "Allowing role in channel...",
  deny_role_in_channel: "Restricting role in channel...",
  remove_role_channel_override: "Removing role channel override...",
  create_role: "Creating role...",
  delete_role: "Deleting role...",
  edit_role: "Editing role...",
  update_role_permissions: "Updating role permissions...",
  add_role_to_user: "Adding role to user...",
  remove_role_from_user: "Removing role from user...",
  list_roles: "Reading roles...",
  get_role_info: "Reading role information...",
  get_user_info: "Reading user information...",
  list_members: "Searching server members...",
  change_nickname: "Changing nickname...",
  kick_user: "Preparing kick...",
  ban_user: "Preparing ban...",
  unban_user: "Preparing unban...",
  timeout_user: "Preparing timeout...",
  remove_timeout: "Removing timeout...",
  mute_user: "Preparing server mute...",
  unmute_user: "Removing server mute...",
  delete_message: "Deleting message...",
  bulk_delete_messages: "Deleting messages...",
  pin_message: "Pinning message...",
  unpin_message: "Unpinning message...",
  get_server_info: "Reading server information...",
  get_audit_logs: "Reading audit logs...",
  create_invite: "Creating invite...",
  delete_invite: "Deleting invite...",
  grant_admin: "Granting AI admin access...",
  revoke_admin: "Revoking AI admin access...",
  list_admins: "Reading AI admin list...",

  getchannelbyname: "Searching channels...",
  getrolemyname: "Searching roles...",
  getuserbyname: "Searching members...",
  channel_permissions: "Reading channel permissions...",
  member_permissions: "Reading member permissions...",
  get_messages: "Reading messages...",
  get_message: "Reading message...",
  create_category: "Creating category...",
  edit_category: "Editing category...",
  delete_category: "Deleting category...",
  send_message: "Sending message...",
  send_embed_message: "Sending embed...",
  edit_message: "Editing message...",
  create_thread: "Creating thread...",
  archive_thread: "Updating thread...",
  add_reaction: "Adding reaction...",
  remove_reaction: "Removing reaction...",
  move_member_voice: "Moving member in voice...",
  disconnect_member_voice: "Disconnecting member from voice...",
  deafen_member: "Deafening member...",
  undeafen_member: "Removing member deafening...",

  dice_roll: "Rolling dice...",
  uuid_generate: "Generating UUID...",
  base64_encode: "Encoding Base64...",
  base64_decode: "Decoding Base64...",
  hash_text: "Hashing text...",
  json_format: "Formatting JSON..."
};

export async function executeDiscordTool({
  toolName,
  args,
  guild,
  requester,
  canAdmin,
  canGrantAdmin,
  permissionsData
}) {
  const isOwner = requester.userId === process.env.OWNER_USER_ID;
  const reason = makeReason(requester, args);

  const aiAdminToolNames = new Set([
    "create_channel",
    "delete_channel",
    "edit_channel",
    "move_channel",
    "lock_channel",
    "unlock_channel",
    "set_channel_slowmode",
    "get_channels",
    "get_channel_info",
    "update_channel_permissions",
    "allow_user_in_channel",
    "deny_user_in_channel",
    "remove_user_channel_override",
    "allow_role_in_channel",
    "deny_role_in_channel",
    "remove_role_channel_override",
    "create_role",
    "delete_role",
    "edit_role",
    "update_role_permissions",
    "add_role_to_user",
    "remove_role_from_user",
    "list_roles",
    "get_role_info",
    "get_user_info",
    "list_members",
    "change_nickname",
    "kick_user",
    "ban_user",
    "unban_user",
    "timeout_user",
    "remove_timeout",
    "mute_user",
    "unmute_user",
    "delete_message",
    "bulk_delete_messages",
    "pin_message",
    "unpin_message",
    "get_server_info",
    "get_audit_logs",
    "create_invite",
    "delete_invite"
  ]);

  if (aiAdminToolNames.has(toolName)) {
    ensureCanUse(canAdmin);
  }

  if (["grant_admin", "revoke_admin", "list_admins"].includes(toolName)) {
    if (!canGrantAdmin) {
      throw new Error("Only RJRYT can manage AI administration access.");
    }
  }

  switch (toolName) {
    case "create_channel": {
      const name = normalizeChannelName(args.name);
      const typeName = args.type || "text";
      const type = CHANNEL_TYPES[typeName];

      if (type === undefined) {
        throw new Error(`Unsupported channel type: ${typeName}`);
      }

      const parentId = extractSnowflake(args.parent_id);
      const parent = parentId
        ? guild.channels.cache.get(parentId)
        : null;

      if (
        parentId &&
        (!parent || parent.type !== ChannelType.GuildCategory)
      ) {
        throw new Error("parent_id must refer to a category channel.");
      }

      const options = {
        name,
        type,
        reason
      };

      if (parent) options.parent = parent.id;
      if (typeof args.nsfw === "boolean") options.nsfw = args.nsfw;

      if (
        Number.isInteger(args.slowmode) &&
        [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildForum,
          ChannelType.GuildMedia
        ].includes(type)
      ) {
        options.rateLimitPerUser = args.slowmode;
      }

      if (
        args.topic &&
        [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildForum,
          ChannelType.GuildMedia
        ].includes(type)
      ) {
        options.topic = String(args.topic).slice(0, 1024);
      }

      const channel = await guild.channels.create(options);

      if (parent && args.sync_permissions !== false) {
        await channel.lockPermissions();
      }

      return {
        success: true,
        channel: channelSummary(channel),
        message: `Created ${channel}.`
      };
    }

    case "delete_channel": {
      const channel = getTextChannel(
        guild,
        args.channel_id,
        requester.channelId
      );

      const deleted = channelSummary(channel);
      await channel.delete(reason);

      return {
        success: true,
        deleted,
        message: `Deleted #${deleted.name}.`
      };
    }

    case "edit_channel": {
      const channel = getTextChannel(
        guild,
        args.channel_id,
        requester.channelId
      );

      const options = { reason };

      if (args.name !== undefined) {
        options.name = normalizeChannelName(args.name);
      }

      if (args.topic !== undefined && "topic" in channel) {
        options.topic = args.topic;
      }

      if (args.nsfw !== undefined && "nsfw" in channel) {
        options.nsfw = Boolean(args.nsfw);
      }

      if (args.slowmode !== undefined && "rateLimitPerUser" in channel) {
        options.rateLimitPerUser = Number(args.slowmode);
      }

      if (args.position !== undefined) {
        options.position = Number(args.position);
      }

      if (Object.prototype.hasOwnProperty.call(args, "parent_id")) {
        options.parent = extractSnowflake(args.parent_id) || null;
      }

      const edited = await channel.edit(options);

      if (args.sync_permissions && edited.parent) {
        await edited.lockPermissions();
      }

      return {
        success: true,
        channel: channelSummary(edited)
      };
    }

    case "move_channel": {
      let channel = getTextChannel(
        guild,
        args.channel_id,
        requester.channelId
      );

      if (Object.prototype.hasOwnProperty.call(args, "parent_id")) {
        const parentId = extractSnowflake(args.parent_id);

        channel = await channel.setParent(parentId || null, {
          lockPermissions: args.sync_permissions !== false,
          reason
        });
      }

      channel = await channel.setPosition(Number(args.position), { reason });

      return {
        success: true,
        channel: channelSummary(channel)
      };
    }

    case "lock_channel": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);

      if (!channel.isTextBased()) {
        throw new Error("Only text-based channels can be locked.");
      }

      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: false },
        { reason }
      );

      return { success: true, message: `Locked ${channel}.` };
    }

    case "unlock_channel": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);

      if (!channel.isTextBased()) {
        throw new Error("Only text-based channels can be unlocked.");
      }

      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: null },
        { reason }
      );

      return { success: true, message: `Unlocked ${channel}.` };
    }

    case "set_channel_slowmode": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);

      if (!channel.isTextBased()) {
        throw new Error("This channel does not support text slowmode.");
      }

      await channel.setRateLimitPerUser(Number(args.seconds), reason);
      return { success: true, channel: channelSummary(channel) };
    }

    case "get_channels":
      return {
        success: true,
        channels: guild.channels.cache
          .sort((a, b) => a.position - b.position)
          .map(channelSummary)
      };

    case "get_channel_info":
      return {
        success: true,
        channel: channelSummary(
          getTextChannel(guild, args.channel_id, requester.channelId)
        )
      };

    case "update_channel_permissions": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      const targetId = extractSnowflake(args.target_id);

      if (!targetId) throw new Error("Invalid permission target ID.");

      if (args.target_type === "role") {
        getRole(guild, targetId);
      } else if (args.target_type === "user") {
        await getMember(guild, targetId);
      } else {
        throw new Error("target_type must be user or role.");
      }

      if (
        args.target_type === "user" &&
        targetId === process.env.OWNER_USER_ID
      ) {
        if (args.clear) {
          throw new Error("The owner's channel override cannot be removed.");
        }

        if ((args.deny || []).length) {
          throw new Error("The owner cannot be denied channel permissions.");
        }
      }

      if (args.clear) {
        await channel.permissionOverwrites.delete(targetId, reason);
        return { success: true, message: "Removed the channel permission override." };
      }

      const allow = Object.fromEntries(
        (args.allow || []).map((name) => [normalizePermissionName(name), true])
      );

      const deny = Object.fromEntries(
        (args.deny || []).map((name) => [normalizePermissionName(name), false])
      );

      await channel.permissionOverwrites.edit(
        targetId,
        { ...allow, ...deny },
        { reason }
      );

      return {
        success: true,
        targetId,
        targetType: args.target_type,
        allow: Object.keys(allow),
        deny: Object.keys(deny)
      };
    }

    case "allow_user_in_channel": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      const member = await getMember(guild, args.user_id);

      await channel.permissionOverwrites.edit(
        member.id,
        { ViewChannel: true },
        { reason }
      );

      return {
        success: true,
        message: `Allowed ${member.user.tag} to view ${channel}.`
      };
    }

    case "deny_user_in_channel": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      const member = await getMember(guild, args.user_id);

      if (member.id === process.env.OWNER_USER_ID) {
        throw new Error("The owner cannot be blocked.");
      }

      await channel.permissionOverwrites.edit(
        member.id,
        { ViewChannel: false },
        { reason }
      );

      return {
        success: true,
        message: `Denied ${member.user.tag} from viewing ${channel}.`
      };
    }

    case "remove_user_channel_override": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      const member = await getMember(guild, args.user_id);

      if (member.id === process.env.OWNER_USER_ID) {
        throw new Error("The owner's channel override cannot be removed.");
      }

      await channel.permissionOverwrites.delete(member.id, reason);
      return { success: true, message: `Removed ${member.user.tag}'s channel override.` };
    }

    case "allow_role_in_channel": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      const role = getRole(guild, args.role_id);

      await channel.permissionOverwrites.edit(
        role.id,
        { ViewChannel: true },
        { reason }
      );

      return { success: true, message: `Allowed role ${role.name} to view ${channel}.` };
    }

    case "deny_role_in_channel": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      const role = getRole(guild, args.role_id);

      await channel.permissionOverwrites.edit(
        role.id,
        { ViewChannel: false },
        { reason }
      );

      return { success: true, message: `Denied role ${role.name} from viewing ${channel}.` };
    }

    case "remove_role_channel_override": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      const role = getRole(guild, args.role_id);

      await channel.permissionOverwrites.delete(role.id, reason);
      return { success: true, message: `Removed role ${role.name}'s channel override.` };
    }

    case "create_role": {
      const role = await guild.roles.create({
        name: String(args.name).slice(0, 100),
        color: args.color || undefined,
        hoist: args.hoist ?? false,
        mentionable: args.mentionable ?? false,
        permissions: permissionBitfield(args.permissions || []),
        reason
      });

      return { success: true, role: roleSummary(role) };
    }

    case "delete_role": {
      const role = getRole(guild, args.role_id);
      requireManageableRole(guild, role);
      const result = roleSummary(role);

      await role.delete(reason);
      return { success: true, deleted: result };
    }

    case "edit_role": {
      const role = getRole(guild, args.role_id);
      requireManageableRole(guild, role);

      const options = { reason };
      if (args.name !== undefined) options.name = String(args.name).slice(0, 100);
      if (args.color !== undefined) options.color = args.color;
      if (args.hoist !== undefined) options.hoist = Boolean(args.hoist);
      if (args.mentionable !== undefined) options.mentionable = Boolean(args.mentionable);
      if (args.position !== undefined) options.position = Number(args.position);

      const edited = await role.edit(options);
      return { success: true, role: roleSummary(edited) };
    }

    case "update_role_permissions": {
      const role = getRole(guild, args.role_id);
      requireManageableRole(guild, role);

      const names = (args.permissions || []).map(normalizePermissionName);
      const bitValues = names.map((name) => PermissionFlagsBits[name]);
      let next = new PermissionsBitField(role.permissions.bitfield);

      if (args.mode === "replace") {
        next = new PermissionsBitField(bitValues);
      } else if (args.mode === "add") {
        next.add(...bitValues);
      } else if (args.mode === "remove") {
        next.remove(...bitValues);
      } else {
        throw new Error("mode must be add, remove, or replace.");
      }

      const edited = await role.setPermissions(next, reason);
      return { success: true, role: roleSummary(edited) };
    }

    case "add_role_to_user": {
      const member = await getMember(guild, args.user_id);
      const role = getRole(guild, args.role_id);
      requireManageableRole(guild, role);

      await member.roles.add(role, reason);
      return { success: true, message: `Added ${role.name} to ${member.user.tag}.` };
    }

    case "remove_role_from_user": {
      const member = await getMember(guild, args.user_id);

      if (member.id === process.env.OWNER_USER_ID) {
        throw new Error("Roles cannot be removed from the configured owner.");
      }

      const role = getRole(guild, args.role_id);
      requireManageableRole(guild, role);
      await member.roles.remove(role, reason);

      return { success: true, message: `Removed ${role.name} from ${member.user.tag}.` };
    }

    case "list_roles":
      return {
        success: true,
        roles: guild.roles.cache
          .sort((a, b) => b.position - a.position)
          .map(roleSummary)
      };

    case "get_role_info":
      return { success: true, role: roleSummary(getRole(guild, args.role_id)) };

    case "get_user_info": {
      const member = await getMember(guild, args.user_id);

      return {
        success: true,
        member: {
          id: member.id,
          username: member.user.username,
          tag: member.user.tag,
          displayName: member.displayName,
          nickname: member.nickname,
          bot: member.user.bot,
          joinedAt: member.joinedAt,
          roles: member.roles.cache
            .filter((role) => role.id !== guild.id)
            .map((role) => ({
              id: role.id,
              name: role.name,
              position: role.position
            }))
        }
      };
    }

    case "list_members": {
      const query = String(args.query || "").trim().toLowerCase();
      const limit = Math.min(Math.max(Number(args.limit || 25), 1), 50);
      const includeBots = Boolean(args.include_bots);

      const members = guild.members.cache
        .filter((member) => includeBots || !member.user.bot)
        .filter(
          (member) =>
            !query ||
            [
              member.user.username,
              member.displayName,
              member.nickname || ""
            ].some((value) => value.toLowerCase().includes(query))
        )
        .first(limit)
        .map((member) => ({
          id: member.id,
          username: member.user.username,
          displayName: member.displayName,
          bot: member.user.bot
        }));

      return {
        success: true,
        members,
        note: "Results are from the cached member list."
      };
    }

    case "change_nickname": {
      const member = await getMember(guild, args.user_id);

      if (
        member.id === process.env.OWNER_USER_ID &&
        args.nickname !== member.nickname
      ) {
        throw new Error("The owner's nickname cannot be changed.");
      }

      requireModeratableMember(guild, member);
      await member.setNickname(args.nickname || null, reason);

      return { success: true, nickname: member.nickname };
    }

    case "kick_user": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);

      if (!member.kickable) {
        throw new Error("Discord does not allow the bot to kick this member.");
      }

      const result = { id: member.id, username: member.user.tag };
      await member.kick(reason);
      return { success: true, kicked: result };
    }

    case "ban_user": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);

      if (!member.bannable) {
        throw new Error("Discord does not allow the bot to ban this member.");
      }

      const result = { id: member.id, username: member.user.tag };
      const days = Math.min(
        Math.max(Number(args.delete_message_days || 0), 0),
        7
      );

      await member.ban({
        deleteMessageSeconds: days * 86400,
        reason
      });

      return { success: true, banned: result };
    }

    case "unban_user": {
      const id = extractSnowflake(args.user_id);
      if (!id) throw new Error("Invalid user ID.");

      await guild.bans.remove(id, reason);
      return { success: true, message: `Unbanned ${id}.` };
    }

    case "timeout_user": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);

      if (!member.moderatable) {
        throw new Error("Discord does not allow the bot to timeout this member.");
      }

      const seconds = Number(args.duration_seconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 2419200) {
        throw new Error("Timeout duration must be between 1 second and 28 days.");
      }

      await member.timeout(seconds * 1000, reason);
      return { success: true, message: `Timed out ${member.user.tag} for ${seconds} seconds.` };
    }

    case "remove_timeout": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);
      await member.timeout(null, reason);
      return { success: true, message: `Removed timeout from ${member.user.tag}.` };
    }

    case "mute_user": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);

      if (!member.voice.channel) {
        throw new Error("The user is not currently in a voice channel.");
      }

      await member.voice.setMute(true, reason);
      return { success: true, message: `Server-muted ${member.user.tag}.` };
    }

    case "unmute_user": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);

      if (!member.voice.channel) {
        throw new Error("The user is not currently in a voice channel.");
      }

      await member.voice.setMute(false, reason);
      return { success: true, message: `Removed server mute from ${member.user.tag}.` };
    }

    case "delete_message": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased()) throw new Error("The channel is not text-based.");

      const message = await channel.messages.fetch(
        extractSnowflake(args.message_id)
      );

      await message.delete(reason);
      return { success: true, messageId: message.id };
    }

    case "bulk_delete_messages": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased() || !channel.bulkDelete) {
        throw new Error("The channel does not support bulk deletion.");
      }

      const count = Number(args.count);
      if (!Number.isInteger(count) || count < 2 || count > 100) {
        throw new Error("count must be between 2 and 100.");
      }

      const deleted = await channel.bulkDelete(count, true);
      return { success: true, deletedCount: deleted.size };
    }

    case "pin_message": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased()) throw new Error("The channel is not text-based.");

      const message = await channel.messages.fetch(
        extractSnowflake(args.message_id)
      );

      await message.pin(reason);
      return { success: true, messageId: message.id };
    }

    case "unpin_message": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased()) throw new Error("The channel is not text-based.");

      const message = await channel.messages.fetch(
        extractSnowflake(args.message_id)
      );

      await message.unpin(reason);
      return { success: true, messageId: message.id };
    }

    case "get_server_info":
      return {
        success: true,
        guild: {
          id: guild.id,
          name: guild.name,
          ownerId: guild.ownerId,
          memberCount: guild.memberCount,
          channelCount: guild.channels.cache.size,
          roleCount: guild.roles.cache.size,
          createdAt: guild.createdAt
        }
      };

    case "get_audit_logs": {
      const limit = Math.min(Math.max(Number(args.limit || 10), 1), 20);
      const logs = await guild.fetchAuditLogs({ limit });

      return {
        success: true,
        entries: logs.entries.map((entry) => ({
          id: entry.id,
          action: entry.action,
          executorId: entry.executorId,
          targetId: entry.targetId,
          reason: entry.reason,
          createdAt: entry.createdAt
        }))
      };
    }

    case "create_invite": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);

      if (!channel.isTextBased() && !channel.isVoiceBased()) {
        throw new Error("The channel cannot create invites.");
      }

      const invite = await channel.createInvite({
        maxAge: Number(args.max_age_seconds ?? 86400),
        maxUses: Number(args.max_uses ?? 0),
        temporary: Boolean(args.temporary),
        unique: args.unique !== false,
        reason
      });

      return {
        success: true,
        code: invite.code,
        url: invite.url,
        channelId: channel.id
      };
    }

    case "delete_invite": {
      const code = String(args.code)
        .replace(/^https?:\/\/discord(?:\.gg|\.com\/invite)\//i, "")
        .trim();

      if (!code) throw new Error("Invite code cannot be empty.");

      await guild.client.rest.delete(`/invites/${encodeURIComponent(code)}`);

      return {
        success: true,
        message: `Deleted invite ${code}.`
      };
    }

    case "grant_admin": {
      if (!isOwner) {
        throw new Error("Only the configured owner can grant AI administration access.");
      }

      const userId = extractSnowflake(args.user_id);
      if (!userId) throw new Error("Invalid user ID.");
      if (userId === process.env.OWNER_USER_ID) {
        return { success: true, message: "RJRYT is already the owner." };
      }

      await getMember(guild, userId);
      await addAdmin(permissionsData, guild.id, userId);

      return {
        success: true,
        message: `Granted AI administration access to ${userId}.`
      };
    }

    case "revoke_admin": {
      if (!isOwner) {
        throw new Error("Only the configured owner can revoke AI administration access.");
      }

      const userId = extractSnowflake(args.user_id);
      if (!userId) throw new Error("Invalid user ID.");
      if (userId === process.env.OWNER_USER_ID) {
        throw new Error("The owner cannot be revoked.");
      }

      await removeAdmin(permissionsData, guild.id, userId);

      return {
        success: true,
        message: `Revoked AI administration access from ${userId}.`
      };
    }

    case "list_admins": {
      if (!canGrantAdmin) {
        throw new Error("Only RJRYT can view the AI admin list.");
      }

      const admins = getGuildAdmins(permissionsData, guild.id);

      return {
        success: true,
        ownerId: process.env.OWNER_USER_ID,
        admins: admins.map((id) => ({
          id,
          tag: guild.members.cache.get(id)?.user?.tag || "Not cached"
        }))
      };
    }

    case "create_category": {
      const name = normalizeChannelName(args.name);
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
        reason
      });
      return { success: true, category: channelSummary(channel), message: `Created category ${channel.name}.` };
    }

    case "edit_category": {
      const category = getTextChannel(guild, args.category_id, requester.channelId);
      if (category.type !== ChannelType.GuildCategory) throw new Error("The selected channel is not a category.");
      const options = { reason };
      if (args.name !== undefined) options.name = normalizeChannelName(args.name);
      const edited = await category.edit(options);
      if (args.position !== undefined) await edited.setPosition(Number(args.position), { reason });
      return { success: true, category: channelSummary(edited), message: `Updated category ${edited.name}.` };
    }

    case "delete_category": {
      const category = getTextChannel(guild, args.category_id, requester.channelId);
      if (category.type !== ChannelType.GuildCategory) throw new Error("The selected channel is not a category.");
      const name = category.name;
      const childChannels = guild.channels.cache.filter((channel) => channel.parentId === category.id).size;
      await category.delete(reason);
      return { success: true, message: `Deleted category ${name}. Child channels (${childChannels}) were not deleted.` };
    }

    case "send_message": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased() || !channel.send) throw new Error("The target channel cannot receive messages.");
      const content = String(args.content ?? "");
      if (!content.trim()) throw new Error("Message content cannot be empty.");
      const chunks = splitForDiscord(content, 1990);
      const sent = [];
      let replyTo = extractSnowflake(args.reply_to_message_id);
      for (const chunk of chunks) {
        const payload = { content: chunk, allowedMentions: { parse: ["users", "roles"] } };
        if (replyTo) payload.reply = { messageReference: replyTo, failIfNotExists: false };
        const message = await channel.send(payload);
        sent.push({ id: message.id, url: message.url, length: chunk.length });
        replyTo = null;
      }
      return { success: true, channelId: channel.id, messages: sent, message: `Sent ${sent.length} message${sent.length === 1 ? "" : "s"}.` };
    }

    case "send_embed_message": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased() || !channel.send) throw new Error("The target channel cannot receive embeds.");
      const { EmbedBuilder } = await import("discord.js");
      const payloads = buildEmbedPayloads(args);
      const sent = [];
      for (let index = 0; index < payloads.length; index += 10) {
        const batch = payloads.slice(index, index + 10).map((payload) => {
          const builder = new EmbedBuilder();
          if (payload.title) builder.setTitle(payload.title);
          if (payload.description !== undefined) builder.setDescription(payload.description);
          if (payload.url) builder.setURL(payload.url);
          if (payload.color !== undefined) builder.setColor(payload.color);
          if (payload.fields.length) builder.addFields(payload.fields);
          if (payload.footer) builder.setFooter(payload.footer);
          if (payload.timestamp) builder.setTimestamp(new Date(payload.timestamp));
          return builder;
        });
        const message = await channel.send({ embeds: batch });
        sent.push({ id: message.id, url: message.url, embedCount: batch.length });
      }
      return { success: true, channelId: channel.id, messages: sent, embedCount: payloads.length, message: `Sent ${payloads.length} embed${payloads.length === 1 ? "" : "s"}.` };
    }

    case "edit_message": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased() || !channel.messages) throw new Error("The channel does not support messages.");
      const messageId = extractSnowflake(args.message_id);
      if (!messageId) throw new Error("Invalid message ID.");
      const content = String(args.content ?? "");
      if (content.length > 2000) throw new Error("Discord message content cannot exceed 2000 characters when editing one message.");
      const message = await channel.messages.fetch(messageId);
      if (message.author.id !== guild.client.user.id) throw new Error("I can only edit messages sent by this bot.");
      await message.edit({ content, allowedMentions: { parse: ["users", "roles"] } });
      return { success: true, message: `Edited message ${message.id}.`, messageId: message.id };
    }

    case "create_thread": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased()) throw new Error("The selected channel does not support threads.");
      const name = String(args.name || "").trim().slice(0, 100);
      if (!name) throw new Error("Thread name cannot be empty.");
      const messageId = extractSnowflake(args.message_id);
      const thread = messageId
        ? await channel.threads.create({ name, startMessage: messageId, autoArchiveDuration: Number(args.auto_archive_minutes || 1440), reason })
        : await channel.threads.create({ name, autoArchiveDuration: Number(args.auto_archive_minutes || 1440), reason });
      return { success: true, thread: channelSummary(thread), message: `Created ${thread}.` };
    }

    case "archive_thread": {
      const thread = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!thread.isThread?.()) throw new Error("The selected channel is not a thread.");
      const options = { archived: Boolean(args.archived), reason };
      if (args.locked !== undefined) options.locked = Boolean(args.locked);
      await thread.setArchived(options.archived, reason);
      if (args.locked !== undefined && thread.setLocked) await thread.setLocked(Boolean(args.locked), reason);
      return { success: true, message: `${thread} is now ${args.archived ? "archived" : "active"}${args.locked ? " and locked" : ""}.` };
    }

    case "add_reaction": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased() || !channel.messages) throw new Error("The channel does not support reactions.");
      const messageId = extractSnowflake(args.message_id);
      if (!messageId) throw new Error("Invalid message ID.");
      const message = await channel.messages.fetch(messageId);
      await message.react(String(args.emoji));
      return { success: true, message: `Reacted to message ${message.id}.` };
    }

    case "remove_reaction": {
      const channel = getTextChannel(guild, args.channel_id, requester.channelId);
      if (!channel.isTextBased() || !channel.messages) throw new Error("The channel does not support reactions.");
      const messageId = extractSnowflake(args.message_id);
      if (!messageId) throw new Error("Invalid message ID.");
      const message = await channel.messages.fetch(messageId);
      await message.reactions.remove(String(args.emoji), guild.client.user.id);
      return { success: true, message: `Removed my reaction from message ${message.id}.` };
    }

    case "move_member_voice": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);
      const channelId = extractSnowflake(args.channel_id);
      if (!channelId) throw new Error("A valid voice channel ID is required.");
      const target = guild.channels.cache.get(channelId);
      if (!target?.isVoiceBased?.()) throw new Error("The target channel is not a voice channel.");
      await member.voice.setChannel(target, reason);
      return { success: true, message: `Moved ${member.user.tag} to ${target}.` };
    }

    case "disconnect_member_voice": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);
      if (!member.voice.channelId) throw new Error("That member is not connected to a voice channel.");
      await member.voice.disconnect(reason);
      return { success: true, message: `Disconnected ${member.user.tag} from voice.` };
    }

    case "deafen_member": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);
      if (!member.voice.channelId) throw new Error("That member is not connected to a voice channel.");
      await member.voice.setDeaf(true, reason);
      return { success: true, message: `Server-deafened ${member.user.tag}.` };
    }

    case "undeafen_member": {
      const member = await getMember(guild, args.user_id);
      requireModeratableMember(guild, member);
      if (!member.voice.channelId) throw new Error("That member is not connected to a voice channel.");
      await member.voice.setDeaf(false, reason);
      return { success: true, message: `Removed server deafening from ${member.user.tag}.` };
    }

    case "dice_roll": {
      const notation = String(args.notation || "").trim();
      if (!notation) throw new Error("Dice notation is required.");
      const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
      if (!match) throw new Error("Invalid dice notation.");
      const count = Math.min(Math.max(parseInt(match[1], 10), 1), 100);
      const sides = Math.min(Math.max(parseInt(match[2], 10), 1), 1000);
      const flatMod = match[3] ? parseInt(match[3], 10) : 0;
      const extraMod = Number.isInteger(args.modifier) ? args.modifier : 0;
      const rolls = [];
      let total = 0;
      for (let i = 0; i < count; i++) {
        const roll = Math.floor(Math.random() * sides) + 1;
        rolls.push(roll);
        total += roll;
      }
      const finalTotal = total + flatMod + extraMod;
      return {
        success: true,
        notation,
        rolls,
        total: finalTotal,
        message: `Rolled ${notation}: [${rolls.join(", ")}] = **${finalTotal}**`
      };
    }

    case "uuid_generate": {
      const id = crypto.randomUUID();
      return {
        success: true,
        uuid: id,
        message: `Generated UUID: ${id}`
      };
    }

    case "base64_encode": {
      const text = String(args.text ?? "");
      if (!text) throw new Error("Text to encode cannot be empty.");
      const encoded = Buffer.from(text, "utf8").toString("base64");
      return {
        success: true,
        encoded,
        message: `Base64 encoded: ${encoded}`
      };
    }

    case "base64_decode": {
      const encoded = String(args.encoded ?? "").trim();
      if (!encoded) throw new Error("Base64 text to decode cannot be empty.");
      try {
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        return {
          success: true,
          decoded,
          message: `Base64 decoded: ${decoded}`
        };
      } catch {
        throw new Error("Invalid Base64 input.");
      }
    }

    case "hash_text": {
      const text = String(args.text ?? "");
      if (!text) throw new Error("Text to hash cannot be empty.");
      const algorithm = String(args.algorithm || "sha256").toLowerCase();
      if (!["sha256", "md5"].includes(algorithm)) {
        throw new Error("Algorithm must be sha256 or md5.");
      }
      const hash = crypto.createHash(algorithm).update(text, "utf8").digest("hex");
      return {
        success: true,
        algorithm,
        hash,
        message: `${algorithm.toUpperCase()} hash: ${hash}`
      };
    }

    case "json_format": {
      const raw = String(args.json ?? "");
      if (!raw.trim()) throw new Error("JSON text cannot be empty.");
      let parsed;
      try { parsed = JSON.parse(raw); } catch (err) {
        throw new Error(`Invalid JSON: ${err.message}`);
      }
      const formatted = JSON.stringify(parsed, null, 2);
      return {
        success: true,
        formatted,
        message: `Formatted JSON:\n${formatted}`
      };
    }

    default:
      return {
        success: false,
        error: `Unknown tool: ${toolName}`
      };
  }
}

function buildEmbedPayloads(args) {
  const title = args.title ? String(args.title).slice(0, 256) : undefined;
  const footerText = args.footer ? String(args.footer).slice(0, 2048) : undefined;
  const url = args.url ? String(args.url).trim() : undefined;
  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error("Embed URL must be a valid http:// or https:// URL.");
    }
  }

  const color = args.color !== undefined ? normalizeColor(args.color) : undefined;
  const rawDescription = String(args.description ?? "");
  if (!rawDescription.trim() && !title && !(Array.isArray(args.fields) && args.fields.length) && !footerText && !url) {
    throw new Error("An embed needs a title, description, field, footer, or URL.");
  }
  const descriptionChunks = splitText(rawDescription, 4096);
  if (!descriptionChunks.length) descriptionChunks.push("");

  const fieldFragments = [];
  const sourceFields = Array.isArray(args.fields) ? args.fields : [];
  for (const [index, field] of sourceFields.entries()) {
    if (!field || typeof field !== "object") throw new Error(`Embed field ${index + 1} must be an object.`);
    let name = String(field.name ?? `Field ${index + 1}`).slice(0, 256);
    if (!name) name = `Field ${index + 1}`;
    const value = String(field.value ?? "");
    if (!value) throw new Error(`Embed field ${index + 1} has an empty value.`);
    const parts = splitText(value, 1024);
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      fieldFragments.push({
        name: parts.length === 1 ? name : `${name} (${partIndex + 1}/${parts.length})`.slice(0, 256),
        value: parts[partIndex],
        inline: Boolean(field.inline)
      });
    }
  }

  const baseChars = (title?.length || 0) + (footerText?.length || 0);
  if (baseChars >= 6000) throw new Error("The embed title/footer is too large for Discord's embed limit.");

  const embeds = [];
  const maxFields = 25;
  let embed = null;
  const makeEmbed = () => ({
    title,
    description: undefined,
    url,
    color,
    fields: [],
    footer: footerText ? { text: footerText } : undefined,
    timestamp: args.timestamp ? new Date().toISOString() : undefined
  });
  const currentChars = (item) =>
    (item.title?.length || 0) +
    (item.description?.length || 0) +
    (item.footer?.text?.length || 0) +
    item.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);

  const flush = () => {
    if (embed) embeds.push(embed);
    embed = null;
  };

  for (const desc of descriptionChunks) {
    if (!embed) embed = makeEmbed();
    if (embed.description) {
      flush();
      embed = makeEmbed();
    }
    embed.description = desc;
    if (currentChars(embed) > 6000) {
      flush();
      embed = makeEmbed();
      embed.description = desc;
    }
    if (currentChars(embed) > 6000) throw new Error("The embed metadata exceeds Discord's 6000-character limit.");
  }

  for (const field of fieldFragments) {
    if (!embed) embed = makeEmbed();
    const projected = currentChars(embed) + field.name.length + field.value.length;
    if (embed.fields.length >= maxFields || projected > 6000) {
      flush();
      embed = makeEmbed();
    }
    embed.fields.push(field);
    if (currentChars(embed) > 6000) throw new Error("The embed exceeds Discord's 6000-character limit.");
  }

  if (!embed) embed = makeEmbed();
  flush();

  return embeds.length ? embeds : [makeEmbed()];
}

function normalizeColor(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
  const text = String(value).trim();
  if (/^#?[0-9a-f]{6}$/i.test(text)) return `#${text.replace(/^#/, "")}`;
  throw new Error("Embed color must be a 6-digit hex color such as #5865F2 or an integer.");
}

function splitText(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf(" ", maxLength);
    if (cut < 1) cut = maxLength;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

