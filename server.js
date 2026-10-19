const express = require("express");
const http = require("http");
const path = require("path");
const { randomInt } = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5
});
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 8; // Hard cap: no arena or private room can exceed eight players.
const ARENA = { width: 1600, height: 1000 };
const TICK_RATE = 30;
const STATE_RATE = 25;
const rooms = new Map();
const playerRoom = new Map();
let nextBulletId = 1;

function makeRoom(code, isPrivate, maxPlayers, hostId = null) {
  return { code, isPrivate, maxPlayers, hostId, players: new Map(), bullets: new Map(), lastState: 0, matchStartedAt: 0, matchEndsAt: 0, endedAt: 0, round: 0 };
}
const publicRoom = makeRoom("PUBLIC", false, MAX_PLAYERS);
rooms.set(publicRoom.code, publicRoom);
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size, players: playerRoom.size }));

function safeName(value) {
  const cleaned = String(value || "Rookie").replace(/[^\w -]/g, "").trim().slice(0, 16);
  return cleaned || "Rookie";
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function spawnPoint() { return { x: 100 + Math.random() * (ARENA.width - 200), y: 100 + Math.random() * (ARENA.height - 200) }; }
const PLAYER_COLORS = ["#62e6a7", "#ffcc66", "#ff6b8a", "#79a8ff", "#c58bff", "#ff914d", "#f472d0", "#54d6e8", "#b7e36b", "#f4f4f5", "#ff5d5d", "#a78bfa", "#34d399", "#f59e0b", "#60a5fa"];
function safeColor(color) {
  return PLAYER_COLORS.includes(String(color || "").toLowerCase()) ? String(color).toLowerCase() : PLAYER_COLORS[randomInt(PLAYER_COLORS.length)];
}
function makePlayer(socket, data) {
  const p = spawnPoint();
  return { id: socket.id, name: safeName(data.name), x: p.x, y: p.y, angle: 0, color: safeColor(data.color), hp: 100, score: 0, kills: 0, deaths: 0, respawnAt: 0, lastShot: 0, lastMove: 0 };
}
function publicPlayer(p) { return { id: p.id, name: p.name, x: p.x, y: p.y, angle: p.angle, color: p.color, hp: p.hp, score: p.score, kills: p.kills, deaths: p.deaths }; }
function notice(room, text, type = "info") { io.to(room.code).emit("notice", { text, type, at: Date.now() }); }
function emitState(room, force = false) {
  const now = Date.now();
  if (!force && now - room.lastState < 1000 / STATE_RATE) return;
  room.lastState = now;
  io.to(room.code).emit("state", { roomCode: room.code, players: [...room.players.values()].map(publicPlayer), bullets: [...room.bullets.values()], isPrivate: room.isPrivate, maxPlayers: room.maxPlayers, playerCount: room.players.size, matchStartedAt: room.matchStartedAt, matchEndsAt: room.matchEndsAt, matchEnded: !!room.endedAt, respawns: [...room.players.values()].filter(p => p.hp <= 0).map(p => ({ id: p.id, respawnAt: p.respawnAt || 0 })) });
}
function leaveRoom(socket) {
  const code = playerRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  playerRoom.delete(socket.id);
  if (!room) return;
  const p = room.players.get(socket.id);
  room.players.delete(socket.id);
  room.bullets.forEach((b, id) => { if (b.owner === socket.id) room.bullets.delete(id); });
  socket.leave(code);
  if (p) notice(room, `${p.name} left the arena`, "leave");
  if (room.code !== "PUBLIC" && room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value || null;
    if (room.hostId) io.to(room.hostId).emit("roomHost", { isHost: true });
  }
  emitState(room, true);
}
function joinRoom(socket, room, data) {
  // Check capacity before moving the player, so a full-room attempt does not eject them from their current room.
  const alreadyInRoom = room.players.has(socket.id);
  if (!alreadyInRoom && room.players.size >= Math.min(8, room.maxPlayers)) {
    socket.emit("joinError", "This room is full (maximum 8 players). Ask the host for another room.");
    return;
  }
  if (playerRoom.has(socket.id)) leaveRoom(socket);
  if (!room.hostId) room.hostId = socket.id;
  const player = makePlayer(socket, data || {});
  room.players.set(socket.id, player);
  playerRoom.set(socket.id, room.code);
  socket.join(room.code);
  socket.emit("joined", { id: socket.id, arena: ARENA, player: publicPlayer(player), roomCode: room.code, isPrivate: room.isPrivate, isHost: room.hostId === socket.id, maxPlayers: room.maxPlayers });
  notice(room, `${player.name} entered the arena`, "join");
  emitState(room, true);
  if (!room.matchStartedAt) { room.matchStartedAt = Date.now(); room.matchEndsAt = room.matchStartedAt + 180000; room.round += 1; }
  io.to(room.code).emit("roomInfo", { roomCode: room.code, isPrivate: room.isPrivate, maxPlayers: room.maxPlayers, playerCount: room.players.size, isHost: room.hostId === socket.id });
  emitPublicRooms();
}
function emitPublicRooms() {
  const list = [...rooms.values()].filter(r => r.code !== "PUBLIC" && !r.isPrivate && !r.endedAt && r.players.size < r.maxPlayers).map(r => ({ code: r.code, playerCount: r.players.size, maxPlayers: r.maxPlayers }));
  io.emit("publicRooms", list);
}
function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(""); } while (rooms.has(code));
  return code;
}

io.on("connection", (socket) => {
  socket.emit("welcome", { arena: ARENA, maxPlayers: MAX_PLAYERS });
  socket.emit("publicRooms", [...rooms.values()].filter(r => r.code !== "PUBLIC" && !r.isPrivate && !r.endedAt && r.players.size < r.maxPlayers).map(r => ({ code: r.code, playerCount: r.players.size, maxPlayers: r.maxPlayers })));
  socket.on("createRoom", (data = {}) => {
    if (playerRoom.has(socket.id)) leaveRoom(socket);
    const requested = Number(data.maxPlayers) || 8;
    const maxPlayers = clamp(Math.floor(requested), 2, 8);
    const code = makeCode();
    const isPrivate = data.isPrivate !== false;
    const room = makeRoom(code, isPrivate, maxPlayers, socket.id);
    rooms.set(code, room);
    joinRoom(socket, room, data);
  });
  socket.on("join", (data = {}) => {
    const requestedCode = String(data.roomCode || "").trim().toUpperCase();
    let room = requestedCode ? rooms.get(requestedCode) : null;
    if (!requestedCode) {
      room = [...rooms.values()].filter(r => r.code !== "PUBLIC" && !r.isPrivate && !r.endedAt && r.players.size < r.maxPlayers)
        .sort((a, b) => (b.players.size / b.maxPlayers) - (a.players.size / a.maxPlayers))[0];
      if (!room) {
        const code = makeCode();
        room = makeRoom(code, false, clamp(Math.floor(Number(data.maxPlayers) || 8), 2, 8), null);
        rooms.set(code, room);
      }
    }
    if (!room) { socket.emit("joinError", "Room not found. Check the code or ask your friend for a new invite link."); return; }
    if (room.endedAt) { socket.emit("joinError", "That match has ended. Please join another lobby."); return; }
    joinRoom(socket, room, data);
  });
  socket.on("listPublicRooms", () => emitPublicRooms());
  socket.on("input", (input = {}) => {
    const code = playerRoom.get(socket.id), room = code && rooms.get(code), p = room && room.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const now = Date.now();
    if (room.endedAt || (room.matchEndsAt && now >= room.matchEndsAt)) return;
    if (now - p.lastMove < 20) return;
    p.lastMove = now;
    const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const length = Math.hypot(dx, dy) || 1;
    const speed = input.dash ? 260 : 190;
    const dt = Math.min(0.05, Math.max(0, Number(input.dt) || 1 / TICK_RATE));
    p.x = clamp(p.x + dx / length * speed * dt, 24, ARENA.width - 24);
    p.y = clamp(p.y + dy / length * speed * dt, 24, ARENA.height - 24);
    if (Number.isFinite(input.angle)) p.angle = input.angle;
  });
  socket.on("shoot", (data = {}) => {
    const code = playerRoom.get(socket.id), room = code && rooms.get(code), p = room && room.players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const now = Date.now();
    if (room.endedAt || (room.matchEndsAt && now >= room.matchEndsAt)) return;
    if (now - p.lastShot < 260) return;
    p.lastShot = now;
    const angle = Number.isFinite(data.angle) ? data.angle : p.angle;
    const id = nextBulletId++;
    room.bullets.set(id, { id, owner: p.id, x: p.x + Math.cos(angle) * 25, y: p.y + Math.sin(angle) * 25, vx: Math.cos(angle) * 560, vy: Math.sin(angle) * 560, born: now, color: p.color });
  });
  socket.on("disconnect", () => leaveRoom(socket));
});

let previousTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, Math.max(0, (now - previousTick) / 1000));
  previousTick = now;
  for (const room of rooms.values()) {
    if (room.matchEndsAt && now >= room.matchEndsAt && !room.endedAt) {
      room.endedAt = now;
      room.bullets.clear();
      const results = [...room.players.values()].map(p => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, score: p.score })).sort((a,b) => b.score-a.score || b.kills-a.kills || a.deaths-b.deaths);
      io.to(room.code).emit("matchEnded", { roomCode: room.code, results, nextRoundIn: 15 });
      notice(room, "Match over! Final scoreboard is displayed for 15 seconds.", "info");
    }
    if (room.endedAt && now - room.endedAt >= 15000) {
      room.endedAt = 0;
      room.matchStartedAt = now;
      room.matchEndsAt = now + 180000;
      room.bullets.clear();
      for (const p of room.players.values()) { const spawn = spawnPoint(); p.x = spawn.x; p.y = spawn.y; p.hp = 100; p.kills = 0; p.deaths = 0; p.score = 0; p.respawnAt = 0; }
      notice(room, "New 3-minute round started!", "join");
    }
    for (const p of room.players.values()) {
      if (p.hp <= 0 && p.respawnAt && now >= p.respawnAt && !room.endedAt) {
        const spawn = spawnPoint(); p.x = spawn.x; p.y = spawn.y; p.hp = 100; p.respawnAt = 0;
        io.to(p.id).emit("respawned", { hp: 100 });
      }
    }
    for (const [id, b] of room.bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < 0 || b.y < 0 || b.x > ARENA.width || b.y > ARENA.height || now - b.born > 1500) { room.bullets.delete(id); continue; }
      for (const p of room.players.values()) {
        if (p.id === b.owner || p.hp <= 0 || room.endedAt || now >= room.matchEndsAt) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < 22) {
          p.hp -= 25; room.bullets.delete(id); io.to(p.id).emit("hit", { hp: p.hp });
          if (p.hp <= 0) {
            const attacker = room.players.get(b.owner);
            p.deaths += 1;
            if (attacker) { attacker.kills += 1; attacker.score += 100; }
            notice(room, `${attacker ? attacker.name : "A player"} eliminated ${p.name}`, "kill");
            p.respawnAt = now + 5000;
          }
          break;
        }
      }
    }
    emitState(room);
  }
}, 1000 / TICK_RATE);

server.listen(PORT, "0.0.0.0", () => console.log(`PixelArena listening on port ${PORT}`));
