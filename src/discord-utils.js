export function extractSnowflake(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).match(/\d{15,25}/);
  return match?.[0] || null;
}

export function normalizeChannelName(value) {
  const name = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_ ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 100);
  if (!name) throw new Error('Channel name cannot be empty.');
  return name;
}

export async function fetchChannelMessages(
  channel,
  maxMessages = 100,
  { includeBots = false } = {},
) {
  const results = [];
  let before;
  const limitTarget = Math.min(Math.max(Number(maxMessages) || 100, 1), 1000);

  while (results.length < limitTarget) {
    const limit = Math.min(100, limitTarget - results.length);
    const options = { limit };
    if (before) options.before = before;

    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;

    for (const message of batch.values()) {
      if (!includeBots && message.author.bot) continue;
      if (!message.content?.trim() && !message.embeds?.length) continue;
      results.push(message);
    }

    before = batch.last()?.id;
    if (batch.size < limit) break;
  }

  return results.sort((a, b) => a.createdTimestamp - b.createdTimestamp).slice(-limitTarget);
}

export function formatMessagesForAI(messages) {
  return messages
    .map((message) => {
      const author =
        message.member?.displayName ||
        message.author?.globalName ||
        message.author?.username ||
        'Unknown user';

      const content =
        message.cleanContent?.trim() ||
        message.content?.trim() ||
        (message.embeds?.length ? `[${message.embeds.length} embed(s)]` : '');

      const timestamp = new Date(message.createdTimestamp).toISOString();
      return `[${timestamp}] ${author} (${message.author?.id || 'unknown'}): ${content}`;
    })
    .join('\n');
}

export function splitForDiscord(text, maxLength = 1900) {
  if (text === null || text === undefined) {
    return ['No response.'];
  }

  if (typeof text !== 'string') {
    if (typeof text?.text === 'string') {
      text = text.text;
    } else if (typeof text?.message === 'string') {
      text = text.message;
    } else {
      try {
        text = JSON.stringify(text, null, 2);
      } catch {
        text = String(text);
      }
    }
  }

  text = String(text);

  if (!text.trim()) {
    return ['No response.'];
  }

  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let current = '';

  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (line.length <= maxLength) {
      current = line;
      continue;
    }

    let remaining = line;

    while (remaining.length > maxLength) {
      let cut = remaining.lastIndexOf(' ', maxLength);

      if (cut < 1) {
        cut = maxLength;
      }

      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }

    current = remaining;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export function summarizeToolArgs(args) {
  if (!args || typeof args !== 'object') {
    return '';
  }

  const ignored = new Set(['reason', 'permissions', 'allow', 'deny']);

  const pairs = [];

  for (const [key, value] of Object.entries(args)) {
    if (ignored.has(key)) continue;

    if (typeof value === 'string' && value.length > 80) {
      pairs.push(`${key}=${value.slice(0, 77)}...`);
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      pairs.push(`${key}=${value}`);
    }
  }

  return pairs.slice(0, 3).join(' • ');
}

export function messageSummary(message) {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author?.id,
      username: message.author?.username,
      tag: message.author?.tag,
      displayName:
        message.member?.displayName || message.author?.globalName || message.author?.username,
      bot: Boolean(message.author?.bot),
    },
    content: String(message.content || '').slice(0, 4000),
    createdAt: message.createdAt,
    url: message.url,
    attachments: [...message.attachments.values()].slice(0, 10).map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      contentType: item.contentType,
      size: item.size,
    })),
    embeds: message.embeds.length,
  };
}

export function channelSummary(channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: channel.position,
    url: channel.url,
    topic: 'topic' in channel ? channel.topic : null,
    nsfw: 'nsfw' in channel ? channel.nsfw : null,
    slowmode: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : null,
    manageable: 'manageable' in channel ? channel.manageable : null,
  };
}

export function roleSummary(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    position: role.position,
    permissions: role.permissions.toArray(),
  };
}

export function memberSummary(member) {
  return {
    id: member.id,
    username: member.user.username,
    tag: member.user.tag,
    displayName: member.displayName,
    nickname: member.nickname,
    bot: Boolean(member.user.bot),
    joinedAt: member.joinedAt,
    roles: member.roles.cache
      .filter((role) => role.id !== member.guild.id)
      .map((role) => ({ id: role.id, name: role.name, position: role.position })),
  };
}

export function safeMessageSummary(message) {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author?.id,
      username: message.author?.username,
      tag: message.author?.tag,
      displayName:
        message.member?.displayName || message.author?.globalName || message.author?.username,
      bot: Boolean(message.author?.bot),
    },
    content: String(message.content || '').slice(0, 4000),
    createdAt: message.createdAt,
    url: message.url,
    attachments: [...message.attachments.values()]
      .slice(0, 10)
      .map((item) => ({ id: item.id, name: item.name, url: item.url, size: item.size })),
    embeds: message.embeds.length,
  };
}
