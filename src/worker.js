// Jingle Flip Worker: serves the game (static assets) and the high score API.
//
//   POST /api/session          -> { id }   start a game session (one-use token)
//   POST /api/scores           <- { name, score, session } -> { ok, rank, top }
//   GET  /api/scores?limit=10  -> { top: [{ name, score, at }] }
//
// Storage: D1 database bound as DB. Tables are created on first use.

const MAX_NAME = 12;
const MAX_POINTS_PER_SEC = 60000; // generous ceiling for a plausible score rate
const MIN_GAME_MS = 15000;        // a 3-ball game cannot end faster than this
const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_SUBMITS_PER_HOUR = 20;

const BLOCKED = /(fuck|shit|cunt|nigg|fag|bitch|dick|cock|pussy|slut|whore|rape|nazi|hitler)/i;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      ip_hash TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      ip_hash TEXT
    )`),
  ]);
  schemaReady = true;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

async function hashIp(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jf:" + ip));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanName(raw) {
  let s = String(raw || "").normalize("NFKC").replace(/[^\p{L}\p{N} ._\-']/gu, "").replace(/\s+/g, " ").trim();
  s = s.slice(0, MAX_NAME);
  if (!s || BLOCKED.test(s.replace(/[^a-z]/gi, ""))) return null;
  return s;
}

async function topScores(db, limit) {
  const { results } = await db
    .prepare("SELECT name, score, created_at AS at FROM scores ORDER BY score DESC, created_at ASC LIMIT ?")
    .bind(limit)
    .all();
  return results;
}

async function handleApi(request, env, url) {
  const db = env.DB;
  if (!db) return json({ error: "Database not configured" }, 503);
  await ensureSchema(db);

  if (url.pathname === "/api/session" && request.method === "POST") {
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE created_at < ?").bind(now - SESSION_TTL_MS),
      db.prepare("INSERT INTO sessions (id, created_at, ip_hash) VALUES (?, ?, ?)").bind(id, now, await hashIp(request)),
    ]);
    return json({ id });
  }

  if (url.pathname === "/api/scores" && request.method === "GET") {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "10", 10) || 10, 1), 100);
    return json({ top: await topScores(db, limit) });
  }

  if (url.pathname === "/api/scores" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }

    const name = cleanName(body.name);
    if (!name) return json({ error: "Please choose a different name" }, 400);

    const score = Number(body.score);
    if (!Number.isInteger(score) || score <= 0 || score > 1e9) return json({ error: "Invalid score" }, 400);

    const sessionId = String(body.session || "");
    const session = await db.prepare("SELECT created_at FROM sessions WHERE id = ?").bind(sessionId).first();
    if (!session) return json({ error: "Session expired, play another game to submit" }, 400);

    const elapsed = Date.now() - session.created_at;
    if (elapsed < MIN_GAME_MS || score > (elapsed / 1000) * MAX_POINTS_PER_SEC) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
      return json({ error: "Score could not be verified" }, 400);
    }

    const ipHash = await hashIp(request);
    const recent = await db
      .prepare("SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ? AND created_at > ?")
      .bind(ipHash, Date.now() - 3600000)
      .first();
    if (recent && recent.n >= MAX_SUBMITS_PER_HOUR) return json({ error: "Too many submissions, try again later" }, 429);

    const now = Date.now();
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId),
      db.prepare("INSERT INTO scores (name, score, created_at, ip_hash) VALUES (?, ?, ?, ?)").bind(name, score, now, ipHash),
    ]);
    const rankRow = await db.prepare("SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > ?").bind(score).first();
    return json({ ok: true, rank: rankRow.rank, top: await topScores(db, 10) });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Send www to the apex domain.
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: "Server error" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
