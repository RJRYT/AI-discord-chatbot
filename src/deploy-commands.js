import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token) throw new Error('DISCORD_TOKEN is missing');
if (!clientId) throw new Error('CLIENT_ID is missing');

const rest = new REST({ version: '10' }).setToken(token);

await rest.put(Routes.applicationCommands(clientId), { body: commands });

console.log(`✅ Deployed ${commands.length} global commands.`);
