# OpenRouter Discord AI Admin Bot

Discord.js bot using OpenRouter's OpenAI-compatible Chat Completions API.
The default model is `openrouter/free`, which automatically selects a compatible free OpenRouter model.

## Features

- Natural Discord chat when mentioned or replied to
- `/ai` chat command
- `/summary`
- OpenRouter free-model routing
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
- Confirmation for dangerous actions
- JSON persistence for AI admins
- Discord role hierarchy checks
- Owner/bot protection
- OpenRouter retry handling for transient 429/5xx/network failures

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
OPENROUTER_MODEL=openrouter/free
```

You can replace it with another OpenRouter model ID later.

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
