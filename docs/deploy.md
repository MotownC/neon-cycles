# Deploying the online server (Render free tier)

One-time setup:

1. Push this repo to GitHub.
2. At https://dashboard.render.com create a **Web Service** from the repo.
   - Runtime: Node. Build command: `npm install`. Start command: `npm start`.
   - Instance type: Free.
3. Done. Every push to the default branch auto-deploys.

Both players open the service URL (e.g. `https://<name>.onrender.com`) —
the Node server serves the game files and the WebSocket relay on one port.

Notes:
- The free tier sleeps after ~15 min idle; the first visit cold-starts in
  ~30 s (the game shows "WAKING UP SERVER…" during connect).
- Local testing: `npm start`, then open two windows at
  `http://localhost:8735` — host in one, join with the code in the other.
