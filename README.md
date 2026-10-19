# PixelArena — Online Battle

A browser-based pixel arena shooter using Node.js, Express, and Socket.IO. The existing visual style is retained; this update adds private friend rooms and smoother client-side rendering/network pacing.

## Features
- WASD/arrow-key movement, mouse/touch aiming, shooting, dash, health, kills, score, leaderboard, and respawns.
- Private rooms with unique five-character invite codes.
- Copyable invite links (`https://YOUR-APP.onrender.com/?room=ABCDE`). Friends open the link and join using their callsign.
- Simple room size selection (2, 4, 6, or 8 players); hard server-side cap of 8 players per room, including the host.
- Separate room state: players and projectiles only interact with others in the same room.
- Public arena remains available when the room code is blank.
- Client-side player position smoothing, input pacing, and server state snapshots paced separately from simulation ticks.
- `/health` endpoint for basic deployment health checks.

## Run locally
1. Install Node.js 20 or newer.
2. Extract this folder and open a terminal in `PixelArena`.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000` in your browser. To test multiplayer, open a second browser window or another device using the same reachable host.

## Play with friends
1. Enter your callsign and select a color.
2. Choose a room size (maximum 8, including you) and click **CREATE PRIVATE ROOM**.
3. In the match, click **COPY INVITE LINK** and send the link to friends.
4. Friends open the link, enter a callsign, and click **JOIN BATTLE**. They can also enter the five-character room code manually.
5. Leaving does not delete a room while other players remain. An empty private room is removed automatically.

## Deploy to Render
1. Upload the contents of this folder to a GitHub repository.
2. In Render, create a **Web Service** connected to that repository.
3. Use build command `npm install` and start command `npm start`.
4. Node 20+ is required. No database or environment secrets are needed for this starter version.
5. After deploy, open the Render URL and use `/health` to check that the server responds.

`render.yaml` is included as a reference. Render's free service may sleep when idle and cold starts can delay the first connection. A single Node process is assumed: in-memory private rooms are not shared between multiple server instances and are cleared when the service restarts. Do not scale this starter to multiple instances without adding shared room/session state and a Socket.IO adapter.

## Beginner-friendly GitHub + Render deployment
1. Download and extract the ZIP on your computer.
2. Open GitHub in your browser and create a repository named `pixelarena` (Public or Private is your choice).
3. Open the repository and choose **Add file → Upload files**.
4. Open the extracted `PixelArena` folder on your computer. Upload the contents inside it (including `package.json`, `server.js`, `render.yaml`, `.gitignore`, `.env.example`, `README.md`, and the `public` folder). Do not upload the outer folder as an extra nested directory.
5. Scroll down and click **Commit changes**.
6. Sign in to Render, choose **New + → Web Service**, and connect your GitHub account if prompted.
7. Select the `pixelarena` repository.
8. Set **Runtime** to `Node`, **Build Command** to `npm install`, and **Start Command** to `npm start`.
9. Choose the Free plan if you want the free tier, then click **Create Web Service**.
10. Wait until Render reports the service is live. Open the provided `https://...onrender.com` URL.
11. Verify the server at `https://YOUR-APP.onrender.com/health` — it should show JSON with `ok: true`.
12. Test private rooms using two browser windows: create a room in one, copy the invite link, open it in the other, enter a different callsign, and join. Try filling the room with more than the selected limit; the server should reject the extra player.
13. When you make future changes, upload/commit the changed files to GitHub. Render redeploys automatically if automatic deploys are enabled.

**Important:** keep the existing `render.yaml` in the repository. Private rooms are stored in memory and disappear if Render restarts the service. Use one Render instance; do not scale to multiple instances without shared room storage and a Socket.IO adapter.

## Verification notes
- Run `npm run check` for a syntax check.
- This is an MVP, not a production-hardened competitive game. Movement and hit detection are server-authoritative but simple; there is no account system, persistent stats, matchmaking queue, anti-cheat system, or durable room storage.


## Match and lobby rules

- Players can create either a public or private room. Both support up to 8 players, with a selectable room limit from 2 to 8.
- Joining with the room-code field blank places a player in an available public room, or creates a public room if none are available. Enter a room code or open an invite URL to join a friend's room.
- Each round lasts 3 minutes. The final temporary scoreboard displays kills, deaths, and score for 15 seconds, then the room automatically begins another round.
- Players who are eliminated respawn after 5 seconds.
- Rooms and match results are held in memory and reset when the server restarts. Use a single Render instance for this starter version.

## Render deployment

1. Extract this ZIP locally.
2. On GitHub, create a repository and upload the *contents* of this folder so `package.json`, `server.js`, `render.yaml`, and `public/` are at the repository root. Commit the files.
3. In Render, choose **New + → Web Service**, connect the repository, and use Node runtime. Build command: `npm install`; start command: `npm start`.
4. Deploy and wait for the service to report Live. Visit the generated URL, then visit `/health` to check the server.
5. Open the game in two browsers and test public joining, private invite links, the 8-player cap, 5-second respawn, and the 3-minute match timer.

Live multiplayer and Render deployment must be tested after deployment; local syntax checks do not verify internet latency or hosted behavior.
