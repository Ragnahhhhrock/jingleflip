# Jingle Flip

Christmas-themed, mobile-first 3D pinball (Three.js + Planck.js), served from a Cloudflare Worker at **jingleflip.com** with an online high score table.

## Layout
- `public/index.html` – the game (single bundled file)
- `public/leaderboard.js` – leaderboard UI (top 10 on the title and game-over screens, name entry)
- `src/worker.js` – Worker: serves `public/` and the `/api/*` high score API
- `wrangler.jsonc` – Worker config (D1 binding `DB`, custom domains)

## High score API
| Method | Path | Notes |
|---|---|---|
| POST | `/api/session` | One-use token issued when a game starts |
| POST | `/api/scores` | `{name, score, session}`; checks session age, score rate, names, 20 submits/hour per IP |
| GET | `/api/scores?limit=10` | Top scores |

Scores live in the D1 database `jingleflip-scores`; tables are created on first request.

## Develop / deploy
```
npm install
npm run dev      # local Worker + local D1 at http://localhost:8787
npm run deploy   # or push to main: Cloudflare Workers Builds deploys automatically
```
