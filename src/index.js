import "dotenv/config";

import { Client, Events, GatewayIntentBits } from "discord.js";

import {
  printBanner,
  printSection,
  printKeyValue,
  info,
  success,
  warn,
  error,
  fatal,
} from "./logger.js";

import {
  isAdmin,
  loadPermissions,
  addAdmin,
  removeAdmin,
  getGuildAdmins,
  isAutochatEnabled,
  enableAutochat,
  disableAutochat,
  getAutochatChannels,
} from "./storage.js";
import {
  fetchChannelMessages,
  formatMessagesForAI,
  splitForDiscord,
  summarizeToolArgs,
} from "./discord-utils.js";
import { runAI } from "./ai.js";
import {
  TOOL_STATUS,
  createToolDeclarations,
  executeDiscordTool,
} from "./tools.js";
import { humanizeError } from "./errors.js";
import { logError, logWarning, closeErrorLog } from "./error-logger.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_USER_ID = process.env.OWNER_USER_ID;

if (!DISCORD_TOKEN) fatal("Boot", "DISCORD_TOKEN is missing. Set it in .env.");
if (!CLIENT_ID) fatal("Boot", "CLIENT_ID is missing. Set it in .env.");
if (!OWNER_USER_ID) fatal("Boot", "OWNER_USER_ID is missing. Set it in .env.");
if (!process.env.NVIDIA_API_KEY)
  fatal("Boot", "NVIDIA_API_KEY is missing. Set it in .env.");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const permissionsData = await loadPermissions();
const queues = new Map();
const cooldowns = new Map();
const autochatCooldowns = new Map();

const HISTORY_SIZE = Math.min(
  Math.max(Number(process.env.CHANNEL_HISTORY || 50), 0),
  1000
);
const MAX_AI_TOOL_LOOPS = Math.max(
  1,
  Number(process.env.MAX_AI_TOOL_LOOPS || 10)
);
const AI_COOLDOWN_MS = Math.max(0, Number(process.env.AI_COOLDOWN_MS || 1500));
const AUTOCHAT_COOLDOWN_MS = Math.max(
  0,
  Number(process.env.AUTOCHAT_COOLDOWN_MS || 8000)
);
const STATUS_HEARTBEAT_MS = Math.max(
  1000,
  Number(process.env.STATUS_HEARTBEAT_MS || 2500)
);

function requestKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function queueKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function getPermissionState(guild, userId) {
  const owner = userId === OWNER_USER_ID;
  const admin = isAdmin(permissionsData, guild.id, userId);

  return {
    isOwner: owner,
    canAdmin: owner || admin,
    canGrantAdmin: owner,
  };
}

function requesterFromMessage(message) {
  return {
    username: message.author.username,
    displayName:
      message.member?.displayName ||
      message.author.globalName ||
      message.author.username,
    userId: message.author.id,
    guildId: message.guild.id,
    channelName: message.channel.name,
    channelId: message.channel.id,
  };
}

function requesterFromInteraction(interaction) {
  return {
    username: interaction.user.username,
    displayName:
      interaction.member?.displayName ||
      interaction.user.globalName ||
      interaction.user.username,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelName: interaction.channel?.name || "unknown",
    channelId: interaction.channelId,
  };
}

function isCoolingDown(guildId, userId) {
  if (AI_COOLDOWN_MS <= 0) return false;

  const key = requestKey(guildId, userId);
  const now = Date.now();
  const last = cooldowns.get(key) || 0;

  if (now - last < AI_COOLDOWN_MS) {
    return true;
  }

  cooldowns.set(key, now);
  return false;
}

function isAutochatCoolingDown(guildId, channelId) {
  if (AUTOCHAT_COOLDOWN_MS <= 0) return false;

  const key = queueKey(guildId, channelId);
  const now = Date.now();
  const last = autochatCooldowns.get(key) || 0;

  if (now - last < AUTOCHAT_COOLDOWN_MS) {
    return true;
  }

  autochatCooldowns.set(key, now);
  return false;
}

function cleanBotMention(content) {
  if (!client.user) return String(content || "").trim();

  return String(content || "")
    .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
    .trim();
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function queueChannel(guildId, channelId, fn) {
  const key = queueKey(guildId, channelId);
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  let wrapped;
  wrapped = current.finally(() => {
    if (queues.get(key) === wrapped) queues.delete(key);
  });
  queues.set(key, wrapped);
  return current;
}

async function sendChunks(target, text) {
  let value = text;
  if (value && typeof value === "object") {
    if (typeof value.text === "string") value = value.text;
    else if (typeof value.message === "string") value = value.message;
    else {
      try {
        value = JSON.stringify(value, null, 2);
      } catch {
        value = String(value);
      }
    }
  }

  const chunks = splitForDiscord(
    typeof value === "string" ? value : String(value ?? "No response.")
  );

  if (target.type === "interaction") {
    if (target.interaction.deferred || target.interaction.replied) {
      await target.interaction.editReply(chunks[0]);
    } else {
      await target.interaction.reply(chunks[0]);
    }
    for (const chunk of chunks.slice(1))
      await target.interaction.followUp(chunk);
    return;
  }

  await target.message.channel.send(chunks[0]);
  for (const chunk of chunks.slice(1)) await target.message.channel.send(chunk);
}

async function safeSendError(target, error, fallback) {
  const content = `❌ ${humanizeError(error, fallback)}`;
  try {
    await sendChunks(target, content);
  } catch (sendError) {
    console.error("ErrorResponder", sendError, {
      original: humanizeError(error, fallback),
    });
    if (target.type === "interaction" && !target.interaction.replied) {
      try {
        await target.interaction.reply({ content, ephemeral: true });
      } catch {}
    }
  }
}

async function createStatusReporter(target) {
  const startedAt = Date.now();
  let stage = "🧠 Nemotron is thinking...";
  let statusMessage = null;

  const render = () =>
    `${stage}\n⏱️ ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

  if (target.type === "interaction") {
    if (!target.interaction.deferred && !target.interaction.replied) {
      await target.interaction.deferReply();
    }
    statusMessage = {
      edit: (content) => target.interaction.editReply(content),
    };
  } else {
    const message = await target.message.reply(render());
    statusMessage = { edit: (content) => message.edit(content) };
  }

  await statusMessage.edit(render()).catch(() => {});
  const timer = setInterval(
    () => void statusMessage.edit(render()).catch(() => {}),
    STATUS_HEARTBEAT_MS
  );

  return {
    update: async (nextStage) => {
      stage = nextStage;
      await statusMessage.edit(render()).catch(() => {});
    },
    finish: async (finalStage) => {
      clearInterval(timer);
      stage = finalStage;
      await statusMessage.edit(render()).catch(() => {});
    },
    elapsed: () => (Date.now() - startedAt) / 1000,
  };
}

async function getReferenceContext(target) {
  if (target.type !== "message") return "";
  const referenceId = target.message.reference?.messageId;
  if (!referenceId) return "";

  try {
    const referenced = await target.channel.messages.fetch(referenceId);
    const author =
      referenced.member?.displayName ||
      referenced.author?.globalName ||
      referenced.author?.username ||
      "Unknown";
    const content =
      referenced.content?.trim() ||
      (referenced.embeds?.length
        ? `[${referenced.embeds.length} embed(s)]`
        : "");
    return `Author: ${author} (${referenced.author.id})\nMessage ID: ${
      referenced.id
    }\nContent: ${content.slice(0, 4000)}`;
  } catch {
    return "[Referenced message was unavailable.]";
  }
}

async function processAI(target, prompt) {
  const guild = target.guild;
  const requester = target.requester;
  const lockKey = requestKey(guild.id, requester.userId);

  await queueChannel(guild.id, target.channel?.id || "dm", async () => {
    if (target.enforceCooldown && isCoolingDown(guild.id, requester.userId)) {
      await safeSendError(
        target,
        new Error("Please wait a moment before sending another AI request."),
        "Please wait a moment before sending another AI request."
      );
      return;
    }

    if (target.autochat && isAutochatCoolingDown(guild.id, target.channel.id))
      return;

    const status = await createStatusReporter(target);

    try {
      await status.update("📚 Reading recent channel context...");

      const history =
        HISTORY_SIZE > 0
          ? await fetchChannelMessages(target.channel, HISTORY_SIZE)
          : [];
      const channelContext = formatMessagesForAI(history);
      const referenceContext = await getReferenceContext(target);

      const { canAdmin, canGrantAdmin } = getPermissionState(
        guild,
        requester.userId
      );
      const toolDefinitions = createToolDeclarations({
        canAdmin,
        canGrantAdmin,
      });

      const result = await runAI({
        prompt,
        channelContext,
        referenceContext,
        requester,
        canAdmin,
        canGrantAdmin,
        toolDefinitions,
        includeServerTools: true,
        onStatus: (stage) => status.update(stage),
        onToolStart: async (name, args) => {
          const base = TOOL_STATUS[name] || `Executing ${name}...`;
          const details = summarizeToolArgs(args);
          await status.update(
            details ? `🔧 ${base}\n${details}` : `🔧 ${base}`
          );
        },
        executeTool: (toolName, args) =>
          executeDiscordTool({
            toolName,
            args,
            guild,
            requester,
            canAdmin,
            canGrantAdmin,
            permissionsData,
          }),
      });

      const modelInfo = result.model ? ` • ${result.model}` : "";
      const usageInfo = result.usage?.total_tokens
        ? `\n📊 ${result.usage.total_tokens} tokens${modelInfo}`
        : modelInfo
        ? `\n🤖 ${result.model}`
        : "";

      await status.finish(
        `✅ AI completed in ${status.elapsed().toFixed(1)}s${usageInfo}`
      );
      await sendChunks(target, result.text);
    } catch (error) {
      logError("AI Request", error, {
        guildId: guild.id,
        userId: requester.userId,
      });
      if (status) await status.finish("❌ AI request failed");
      await safeSendError(target, error, "The AI request failed.");
    }
  });
}

async function processSummary(target, count = 100) {
  await queueChannel(target.guild.id, target.channel?.id || "dm", async () => {
    let status;
    try {
      status = await createStatusReporter(target);
      await status.update("📚 Reading channel history...");
      const messages = await fetchChannelMessages(target.channel, count);

      if (!messages.length) {
        await status.finish("✅ Nothing to summarize");
        await sendChunks(
          target,
          "There are no readable messages to summarize."
        );
        return;
      }

      await status.update(`🧠 Summarizing ${messages.length} messages...`);
      const result = await runAI({
        prompt:
          "Summarize this Discord conversation. Include a concise overview, decisions, tasks, questions, and unresolved issues. Do not invent information.\n\n" +
          formatMessagesForAI(messages),
        channelContext: "",
        requester: target.requester,
        canAdmin: false,
        canGrantAdmin: false,
        toolDefinitions: [],
        includeServerTools: false,
        onStatus: (stage) => status.update(stage),
        onToolStart: async () => {},
        executeTool: async () => ({
          success: false,
          error: "Tools are disabled in summary mode.",
        }),
      });

      await status.finish(
        `✅ Summary ready in ${status.elapsed().toFixed(1)}s`
      );
      await sendChunks(target, result.text);
    } catch (error) {
      logError("Summary", error, {
        guildId: target.guild.id,
        channelId: target.channel?.id,
      });
      if (status) await status.finish("❌ Summary failed");
      await safeSendError(target, error, "Unable to summarize this channel.");
    }
  });
}

async function handleAutochatCommand(interaction) {
  const userId = interaction.user.id;
  const { canAdmin } = getPermissionState({ id: interaction.guildId }, userId);

  if (!canAdmin) {
    await interaction.editReply({
      content: "❌ You do not have AI administration permission.",
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const selected = interaction.options.getChannel("channel");
  const channel = selected || interaction.channel;

  if (!channel || channel.type !== 0) {
    await interaction.editReply({
      content: "❌ Autochat can only be enabled on text channels.",
    });
    return;
  }

  if (subcommand === "setup") {
    const enabledIds = getAutochatChannels(
      permissionsData,
      interaction.guildId
    );
    const enabledChannels = enabledIds
      .map((id) => interaction.guild?.channels.cache.get(id))
      .filter((ch) => ch?.type === 0);
    const channelList = enabledChannels.length
      ? enabledChannels.map((ch) => `• ${ch} (${ch.id})`).join("\n")
      : "• No channels enabled";

    await interaction.editReply(
      `🤖 **Autochat setup**\n\n` +
        `Use **/autochat enable** to enable automatic AI replies in the current channel.\n` +
        `Use **/autochat enable channel:#name** to enable another text channel.\n` +
        `Use **/autochat disable** to stop it.\n` +
        `Use **/autochat status** to inspect a channel.\n` +
        `Use **/autochat list** to list enabled channels.\n\n` +
        `⏱️ Autochat cooldown: ${AUTOCHAT_COOLDOWN_MS / 1000}s\n` +
        `Server tools: none\n\n` +
        `**Enabled channels**\n${channelList}`
    );
    return;
  }

  if (subcommand === "enable") {
    await enableAutochat(permissionsData, interaction.guildId, channel.id);
    await interaction.editReply(
      `✅ Autochat enabled in ${channel}.\nEvery normal user message can now trigger an AI reply.\n⏱️ Cooldown: ${
        AUTOCHAT_COOLDOWN_MS / 1000
      }s`
    );
    return;
  }

  if (subcommand === "disable") {
    await disableAutochat(permissionsData, interaction.guildId, channel.id);
    await interaction.editReply(`✅ Autochat disabled in ${channel}.`);
    return;
  }

  if (subcommand === "status") {
    const enabled = isAutochatEnabled(
      permissionsData,
      interaction.guildId,
      channel.id
    );
    await interaction.editReply(
      `🤖 Autochat in ${channel}: **${
        enabled ? "ENABLED" : "DISABLED"
      }**\n⏱️ Cooldown: ${AUTOCHAT_COOLDOWN_MS / 1000}s`
    );
    return;
  }

  if (subcommand === "list") {
    const ids = getAutochatChannels(permissionsData, interaction.guildId);
    const validChannels = ids
      .map((id) => interaction.guild?.channels.cache.get(id))
      .filter((ch) => ch?.type === 0);
    const body = validChannels.length
      ? validChannels.map((ch) => `• ${ch} (${ch.id})`).join("\n")
      : "No text channels have autochat enabled.";
    await interaction.editReply(`🤖 **Autochat channels**\n${body}`);
  }
}

async function handleAdminSlashCommand(interaction, action) {
  if (interaction.user.id !== OWNER_USER_ID) {
    await interaction.reply({
      content:
        "❌ Only the configured owner can manage AI administration access.",
      ephemeral: true,
    });
    return;
  }

  const user = interaction.options.getUser("user");
  try {
    if (action === "grant") {
      if (user.id === OWNER_USER_ID) {
        await interaction.editReply({
          content: "✅ The owner is already an AI administrator.",
        });
        return;
      }
      await addAdmin(permissionsData, interaction.guildId, user.id);
      await interaction.editReply(
        `✅ <@${user.id}> can now use AI administration tools.`
      );
      return;
    }

    if (user.id === OWNER_USER_ID)
      throw new Error("The owner cannot be revoked.");
    await removeAdmin(permissionsData, interaction.guildId, user.id);
    await interaction.editReply(
      `✅ Removed AI administration access from <@${user.id}>.`
    );
  } catch (error) {
    logError("AdminCommand", error, {
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      targetId: user.id,
    });
    await safeSendError(
      { type: "interaction", interaction },
      error,
      "Unable to change AI-admin access."
    );
  }
}

printBanner();

client.once(Events.ClientReady, (readyClient) => {
  printSection("Bot Ready");
  printKeyValue("Logged in as", readyClient.user.tag);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guildId) return;

  try {
    // Acknowledge immediately so Discord never shows "The application did not respond"
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    const guild = interaction.guild ?? { id: interaction.guildId };
    const target = {
      type: "interaction",
      interaction,
      guild,
      channel: interaction.channel,
      requester: requesterFromInteraction(interaction),
      enforceCooldown: false,
      autochat: false,
    };

    if (interaction.commandName === "ai") {
      await processAI(target, interaction.options.getString("message", true));
      return;
    }
    if (interaction.commandName === "summary") {
      await processSummary(
        target,
        interaction.options.getInteger("messages") || 100
      );
      return;
    }
    if (interaction.commandName === "autochat") {
      await handleAutochatCommand(interaction);
      return;
    }
    if (interaction.commandName === "grant-admin") {
      await handleAdminSlashCommand(interaction, "grant");
      return;
    }
    if (interaction.commandName === "revoke-admin") {
      await handleAdminSlashCommand(interaction, "revoke");
      return;
    }
    if (interaction.commandName === "list-admins") {
      if (interaction.user.id !== OWNER_USER_ID) {
        await interaction.editReply({
          content: "❌ Only the configured owner can view the AI admin list.",
        });
        return;
      }
      const ids = getGuildAdmins(permissionsData, guild.id);
      const body = ids.length
        ? ids.map((id) => `• <@${id}> (${id})`).join("\n")
        : "No additional AI administrators are configured.";
      await interaction.editReply(
        `👑 **Owner**\n<@${OWNER_USER_ID}>\n\n🛡️ **AI administrators**\n${body}`
      );
    }
  } catch (error) {
    logError("Interaction", error, {
      command: interaction.commandName,
      guildId: interaction.guildId,
      userId: interaction.user?.id,
    });
    if (!interaction.replied && !interaction.deferred) {
      await safeSendError(
        { type: "interaction", interaction },
        error,
        "The command failed."
      );
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.channel.isTextBased()) return;

  try {
    const raw = message.content || "";
    const prefixMatch = /^!ai\b/i.test(raw);
    const mentioned = client.user
      ? message.mentions.users.has(client.user.id)
      : false;

    let repliedToBot = false;
    if (message.reference?.messageId) {
      try {
        const referenced = await message.channel.messages.fetch(
          message.reference.messageId
        );
        repliedToBot = referenced.author?.id === client.user?.id;
      } catch {
        repliedToBot = false;
      }
    }

    const autochat = isAutochatEnabled(
      permissionsData,
      message.guild.id,
      message.channel.id
    );
    if (!prefixMatch && !mentioned && !repliedToBot && !autochat) return;
    if (autochat && message.channel.isThread?.()) return;

    let prompt = raw;
    if (prefixMatch) prompt = prompt.replace(/^!ai\b/i, "").trim();
    prompt = cleanBotMention(prompt);
    if (!prompt) return;

    await processAI(
      {
        type: "message",
        message,
        guild: message.guild,
        channel: message.channel,
        requester: requesterFromMessage(message),
        enforceCooldown: !autochat,
        autochat,
      },
      prompt
    );
  } catch (error) {
    logError("MessageCreate", error, {
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
    });
    try {
      await message.reply(
        `❌ ${humanizeError(error, "I could not process that message.")}`
      );
    } catch {}
  }
});

client.on(Events.Error, (error) => logError("DiscordClient", error));
client.on(Events.Warn, (warning) =>
  logWarning("DiscordClient", String(warning))
);

process.on("unhandledRejection", (error) =>
  logError("UnhandledRejection", error)
);
process.on("uncaughtException", (error) => {
  logError("UncaughtException", error);
  process.exitCode = 1;
});

async function shutdown(signal) {
  console.log(`🛑 ${signal}: shutting down...`);
  try {
    await closeErrorLog();
  } catch {}
  try {
    client.destroy();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(DISCORD_TOKEN);
