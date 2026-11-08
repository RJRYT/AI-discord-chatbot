import { SlashCommandBuilder, ChannelType } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Ask the Nemotron Discord assistant")
    .addStringOption((option) => option.setName("message").setDescription("Message for the AI").setRequired(true)),

  new SlashCommandBuilder()
    .setName("summary")
    .setDescription("Summarize this channel with Nemotron AI")
    .addIntegerOption((option) => option.setName("messages").setDescription("Number of messages to analyze").setMinValue(20).setMaxValue(1000).setRequired(false)),

  new SlashCommandBuilder()
    .setName("autochat")
    .setDescription("Configure automatic AI replies")
    .addSubcommand((sub) => sub.setName("setup").setDescription("Show autochat setup and current configuration"))
    .addSubcommand((sub) => sub.setName("enable").setDescription("Enable autochat").addChannelOption((option) => option.setName("channel").setDescription("Channel; defaults to current channel").addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand((sub) => sub.setName("disable").setDescription("Disable autochat").addChannelOption((option) => option.setName("channel").setDescription("Channel; defaults to current channel").addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand((sub) => sub.setName("status").setDescription("Show autochat status").addChannelOption((option) => option.setName("channel").setDescription("Channel; defaults to current channel").addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand((sub) => sub.setName("list").setDescription("List enabled autochat channels")),

  new SlashCommandBuilder()
    .setName("grant-admin")
    .setDescription("Grant AI administration access")
    .addUserOption((option) => option.setName("user").setDescription("User to grant access to").setRequired(true)),

  new SlashCommandBuilder()
    .setName("revoke-admin")
    .setDescription("Revoke AI administration access")
    .addUserOption((option) => option.setName("user").setDescription("User to revoke").setRequired(true)),

  new SlashCommandBuilder().setName("list-admins").setDescription("List AI administrators")
].map((command) => command.toJSON());
