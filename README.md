# NVIDIA Nemotron Discord AI Admin Bot

Discord.js bot using NVIDIA's Nemotron API via `https://integrate.api.nvidia.com/v1/chat/completions`.
The default model is `nvidia/nemotron-3.5-super-vl-120b-a12b`.

## Features

- Natural Discord chat when mentioned or replied to
- `/ai` chat command
- `/summary`
- NVIDIA Nemotron model routing
- Tool calling
- Visible AI progress message with elapsed time
- Heartbeat status updates while the AI is working
- Channel create/delete/edit/move/lock/unlock/slowmode
- User/role channel permission overrides
- Role create/delete/edit/permissions
- Add/remove roles from users
- User/member lookup
- Kick/ban/unban/timeout/mute
- Message delete/bulk delete/pin/unpin
- Audit log lookup
- Invite create/delete
- Owner-only AI admin grant/revoke/list
- JSON persistence for AI admins
- Discord role hierarchy checks
- Owner/bot protection
- NVIDIA API retry handling for transient failures

## Install

```bash
npm install
```

Copy `.env.example` to `.env` and fill the values.

```bash
npm run deploy
npm start
```

## Default model

```env
NVIDIA_MODEL=nvidia/nemotron-3.5-super-vl-120b-a12b
```

You can replace it with another NVIDIA model ID later.

## Required environment variables

- `DISCORD_TOKEN` — Discord bot token
- `CLIENT_ID` — Discord application client ID
- `OWNER_USER_ID` — Your Discord user ID (bot owner)
- `NVIDIA_API_KEY` — NVIDIA API key (starts with `nvapi-`)

Optional:

- `NVIDIA_MAX_RETRIES` — max retry attempts (default: 4)
- `NVIDIA_RETRY_BASE_MS` — base retry delay in ms (default: 1200)
- `CHANNEL_HISTORY` — recent messages to read as context (default: 50, max: 1000)
- `MAX_AI_TOOL_LOOPS` — max AI tool-calling iterations (default: 10)
- `AI_COOLDOWN_MS` — cooldown between AI requests per user (default: 2500)
- `AUTOCHAT_COOLDOWN_MS` — cooldown between autochat replies per channel (default: 8000)
- `STATUS_HEARTBEAT_MS` — heartbeat interval while AI is working (default: 2500)

## Required Discord intents

- Guilds
- Guild Messages
- Message Content
- Guild Members
- Guild Voice States

## Recommended bot permissions

- View Channels
- Send Messages
- Read Message History
- Manage Channels
- Manage Roles
- Manage Messages
- Kick Members
- Ban Members
- Moderate Members
- Mute Members
- View Audit Log
- Create Invite

The bot's highest role must be above roles/users it needs to manage.
