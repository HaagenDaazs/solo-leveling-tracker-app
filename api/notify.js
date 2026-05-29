// /api/notify.js
// Vercel serverless function - called by cron-job.org every 5 minutes
// Uses FCM V1 API (Legacy is disabled on your project)

const BOSSES = {
  goblin_king:       { name:"Goblin King",        tier:"common",    timeLimitMs: 2*60*60*1000,  xpReward:80   },
  stone_sentinel:    { name:"Stone Sentinel",     tier:"uncommon",  timeLimitMs: 4*60*60*1000,  xpReward:180  },
  shadow_mage:       { name:"Shadow Mage",        tier:"rare",      timeLimitMs: 8*60*60*1000,  xpReward:400  },
  phantom_warlord:   { name:"Phantom Warlord",    tier:"epic",      timeLimitMs: 12*60*60*1000, xpReward:800  },
  ancient_sovereign: { name:"Ancient Sovereign",  tier:"legendary", timeLimitMs: 18*60*60*1000, xpReward:1500 },
  void_deity:        { name:"Void Deity",         tier:"mythic",    timeLimitMs: 24*60*60*1000, xpReward:2500 },
};

// ── JWT / OAuth2 for FCM V1 ───────────────────────────────────────────────────

async function getAccessToken() {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
  };

  const encode = obj => btoa(JSON.stringify(obj)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  const header  = encode({ alg:"RS256", typ:"JWT" });
  const body    = encode(payload);
  const unsigned = `${header}.${body}`;

  const keyData = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/,"")
    .replace(/-----END PRIVATE KEY-----/,"")
    .replace(/\s/g,"");
  const keyBuffer = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBuffer.buffer,
    { name:"RSASSA-PKCS1-v1_5", hash:"SHA-256" },
    false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  const jwt = `${unsigned}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type":"application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

const PROJECT_ID = "solo-leveling-tracker-26bf0";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFirestoreFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k,v]) => {
    if (typeof v === "boolean") return [k, { booleanValue: v }];
    if (typeof v === "number")  return [k, { integerValue: String(v) }];
    return [k, { stringValue: String(v ?? "") }];
  }));
}

function fromFirestoreFields(fields) {
  if (!fields) return null;
  return Object.fromEntries(Object.entries(fields).map(([k,v]) =>
    [k, v.stringValue ?? v.integerValue ?? v.booleanValue ?? v.doubleValue ?? null]
  ));
}

async function fsGet(token, collection, docId) {
  const res = await fetch(`${FS_BASE}/${collection}/${docId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return fromFirestoreFields(data.fields);
}

async function fsSet(token, collection, docId, fields) {
  await fetch(`${FS_BASE}/${collection}/${docId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type":"application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
}

async function fsList(token, collection) {
  const res = await fetch(`${FS_BASE}/${collection}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map(doc => ({
    id: doc.name.split("/").pop(),
    ...fromFirestoreFields(doc.fields)
  }));
}

// ── FCM V1 push sender ────────────────────────────────────────────────────────

async function sendPush(accessToken, fcmToken, title, body) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title, body },
        webpush: {
          notification: {
            title, body,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag: "sl-tracker",
            renotify: true,
          },
          fcm_options: { link: "/" }
        }
      }
    }),
  });
  const result = await res.json();
  return res.ok ? true : (console.error("FCM error:", result), false);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function isDailyResetWindow() {
  const now = new Date();
  const totalMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return totalMins < 10; // 00:00–00:10 UTC
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const token  = await getAccessToken();
    const users  = await fsList(token, "users");
    const today  = getTodayUTC();
    const doReset = isDailyResetWindow();
    const actions = [];

    for (const user of users) {
      if (!user.fcmToken) continue;
      const { id, fcmToken, bossId, bossStartTime, bossFailed, bossWon,
              lastResetNotif, lastBossSpawnNotif } = user;

      // 1 ── Boss appeared notification ──────────────────────────────────────
      if (bossId && bossFailed !== true && bossWon !== true && lastBossSpawnNotif !== bossId) {
        const boss = BOSSES[bossId];
        if (boss) {
          const hours = boss.timeLimitMs / 3600000;
          const sent = await sendPush(token, fcmToken,
            `⚔ ${boss.name.toUpperCase()} HAS APPEARED`,
            `A ${boss.tier} boss challenges you. You have ${hours} hour${hours!==1?"s":""} to defeat it.`
          );
          if (sent) {
            await fsSet(token, "users", id, { ...user, lastBossSpawnNotif: bossId });
            actions.push({ userId: id, action:"boss_appeared", boss:boss.name });
          }
        }
      }

      // 2 ── Boss 30-min warning + expiry notification ───────────────────────
      if (bossId && bossFailed !== true && bossWon !== true && bossStartTime) {
        const boss = BOSSES[bossId];
        if (boss) {
          const elapsed  = Date.now() - Number(bossStartTime);
          const timeLeft = boss.timeLimitMs - elapsed;
          const warnKey  = `bossWarn_${bossId}`;
          const expKey   = `bossExpired_${bossId}`;

          if (timeLeft > 0 && timeLeft <= 30*60*1000 && !user[warnKey]) {
            const minsLeft = Math.floor(timeLeft / 60000);
            const sent = await sendPush(token, fcmToken,
              `⚠ ${boss.name} is escaping!`,
              `Only ${minsLeft} minute${minsLeft!==1?"s":""} left. Open the app and defeat it now!`
            );
            if (sent) {
              await fsSet(token, "users", id, { ...user, [warnKey]: true });
              actions.push({ userId:id, action:"boss_warning", boss:boss.name });
            }
          }

          if (timeLeft <= 0 && !user[expKey]) {
            const xpLoss = Math.floor(boss.xpReward * 0.2);
            const sent = await sendPush(token, fcmToken,
              `💀 ${boss.name} escaped!`,
              `The ${boss.tier} boss fled. -${xpLoss} XP penalty applied. The dungeon remembers.`
            );
            if (sent) {
              await fsSet(token, "users", id, { ...user, [expKey]: true });
              actions.push({ userId:id, action:"boss_expired", boss:boss.name });
            }
          }
        }
      }

      // 3 ── Daily reset notification ────────────────────────────────────────
      if (doReset && lastResetNotif !== today) {
        const sent = await sendPush(token, fcmToken,
          "⚔ New Day. New Quests.",
          "The dungeon has reset. Your daily tasks await. Don't let the streak die."
        );
        if (sent) {
          await fsSet(token, "users", id, { ...user, lastResetNotif: today });
          actions.push({ userId:id, action:"daily_reset" });
        }
      }
    }

    return res.status(200).json({ ok:true, processed:users.length, actions });
  } catch (err) {
    console.error("notify error:", err);
    return res.status(500).json({ error: err.message });
  }
}
