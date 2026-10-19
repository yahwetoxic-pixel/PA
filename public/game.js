(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const lobby = $("lobby"), game = $("game"), canvas = $("arena"), ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  let myId = null, arena = { width: 1600, height: 1000 }, playerColor = "#62e6a7", currentRoom = "PUBLIC", isPrivateRoom = false, matchEndsAt = 0, matchEnded = false, respawnAt = 0;
  let players = [], bullets = [], self = null, joined = false, mouse = { x: 0, y: 0, down: false };
  const renderPositions = new Map();
  const roomCodeInput = $("roomCode");
  const inviteCode = new URLSearchParams(location.search).get("room");
  if (inviteCode) roomCodeInput.value = inviteCode.toUpperCase().slice(0, 5);
  const keys = {};
  const notices = [];
  const colors = [...document.querySelectorAll(".swatch")];
  colors.forEach(btn => btn.addEventListener("click", () => {
    colors.forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected"); playerColor = btn.dataset.color;
  }));

  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("joinError").textContent = "";
    if (!socket.connected) { $("joinError").textContent = "Connecting to server… try again in a moment."; return; }
    socket.emit("join", { name: $("playerName").value, color: playerColor, roomCode: roomCodeInput.value.trim().toUpperCase(), maxPlayers: Number($("roomLimit").value) });
  });
  $("createRoomBtn").addEventListener("click", () => {
    $("joinError").textContent = "";
    if (!socket.connected) { $("joinError").textContent = "Connecting to server… try again in a moment."; return; }
    if (!$ ("playerName").value.trim()) { $("joinError").textContent = "Enter your callsign first."; $("playerName").focus(); return; }
    socket.emit("createRoom", { name: $("playerName").value, color: playerColor, maxPlayers: Number($("roomLimit").value), isPrivate: $("roomType").value === "private" });
  });
  $("inviteBtn").addEventListener("click", async () => {
    const url = `${location.origin}/?room=${encodeURIComponent(currentRoom)}`;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
      else { const temp = document.createElement("textarea"); temp.value = url; document.body.appendChild(temp); temp.select(); document.execCommand("copy"); temp.remove(); }
      $("inviteBtn").textContent = "INVITE LINK COPIED!";
      setTimeout(() => { if ($("inviteBtn")) $("inviteBtn").textContent = "COPY INVITE LINK"; }, 1800);
    } catch { window.prompt("Copy this invite link for your friends:", url); }
  });
  $("leaveBtn").addEventListener("click", () => location.reload());
  socket.on("connect_error", () => { $("joinError").textContent = "Could not connect. Refresh the page and try again."; });
  socket.on("welcome", data => { arena = data.arena || arena; });
  socket.on("joinError", msg => { $("joinError").textContent = msg; });
  socket.on("joined", data => {
    myId = data.id; arena = data.arena || arena; joined = true;
    currentRoom = data.roomCode || "PUBLIC"; isPrivateRoom = !!data.isPrivate;
    lobby.classList.add("hidden"); game.classList.remove("hidden");
    $("roomBadge").textContent = isPrivateRoom ? `// PRIVATE ${currentRoom}` : "// PUBLIC";
    $("inviteBtn").classList.remove("hidden");
    if (isPrivateRoom) history.replaceState(null, "", `/?room=${encodeURIComponent(currentRoom)}`);
    $("selfName").textContent = data.player.name.toUpperCase();
    $("selfDot").style.background = data.player.color;
    addNotice("You're in. Good luck!", "join");
    resizeCanvas();
  });
  socket.on("state", state => {
    players = state.players || []; bullets = state.bullets || [];
    for (const p of players) {
      const pos = renderPositions.get(p.id);
      if (!pos) renderPositions.set(p.id, { x: p.x, y: p.y });
      else { pos.tx = p.x; pos.ty = p.y; }
    }
    const activeIds = new Set(players.map(p => p.id));
    for (const id of renderPositions.keys()) if (!activeIds.has(id)) renderPositions.delete(id);
    self = players.find(p => p.id === myId) || null;
    if (state.roomCode) currentRoom = state.roomCode;
    matchEndsAt = state.matchEndsAt || matchEndsAt;
    if (matchEnded && !state.matchEnded) {
      matchEnded = false;
      $("matchResults").classList.add("hidden");
    } else if (state.matchEnded) matchEnded = true;
    if (self && self.hp <= 0) {
      const r = (state.respawns || []).find(x => x.id === myId);
      respawnAt = r ? r.respawnAt : respawnAt;
      $("respawnNotice").classList.remove("hidden");
    } else { respawnAt = 0; $("respawnNotice").classList.add("hidden"); }
    $("onlineCount").textContent = players.length;
    renderStats(); renderLeaderboard();
  });
  socket.on("notice", n => addNotice(n.text, n.type));
  socket.on("matchEnded", data => {
    matchEnded = true;
    const rows = (data.results || []).map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}${p.id === myId ? " (YOU)" : ""}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.score}</td></tr>`).join("");
    $("resultsRows").innerHTML = rows || '<tr><td colspan="5">No players recorded.</td></tr>';
    $("matchResults").classList.remove("hidden");
    let seconds = data.nextRoundIn || 15;
    $("nextRoundText").textContent = `Next round starts in ${seconds} seconds.`;
    const started = Date.now();
    const update = () => {
      if (!$ ("matchResults") || $("matchResults").classList.contains("hidden")) return;
      const left = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      $("nextRoundText").textContent = left ? `Next round starts in ${left} seconds.` : "Starting next round…";
      if (left > 0) setTimeout(update, 250);
    };
    update();
  });
  socket.on("respawned", () => { respawnAt = 0; $("respawnNotice").classList.add("hidden"); });
  socket.on("hit", data => {
    $("hitFlash").classList.remove("active"); void $("hitFlash").offsetWidth; $("hitFlash").classList.add("active");
  });

  function addNotice(text, type = "info") {
    notices.unshift({ text, type, at: Date.now() });
    notices.splice(6);
    $("feedItems").innerHTML = notices.map(n => `<p class="feed-item ${n.type === "kill" ? "kill" : n.type === "join" ? "join" : ""}">${escapeHtml(n.text)}</p>`).join("");
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  function renderStats() {
    if (!self) return;
    $("hpText").textContent = `${self.hp}%`;
    $("hpBar").style.width = `${self.hp}%`;
    $("hpBar").style.background = self.hp <= 35 ? "#ff6b8a" : "var(--mint)";
    $("kills").textContent = self.kills;
    $("score").textContent = self.score;
  }
  function renderLeaderboard() {
    const sorted = [...players].sort((a,b) => b.score-a.score || b.kills-a.kills).slice(0,8);
    $("leaderboard").innerHTML = sorted.length ? sorted.map((p,i) => `<li><span class="rank">${String(i+1).padStart(2,"0")}</span><span style="width:8px;height:8px;background:${p.color};display:inline-block"></span><span class="rank-name">${escapeHtml(p.name)}${p.id===myId?" (YOU)":""}</span><b class="rank-score">${p.score}</b></li>`).join("") : '<li class="empty">Waiting for fighters…</li>';
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(320, Math.floor(rect.width * dpr));
    canvas.height = Math.max(200, Math.floor(rect.width * 0.625 * dpr));
    ctx.setTransform(canvas.width / 960, 0, 0, canvas.height / 600, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener("resize", resizeCanvas);
  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = (clientX - rect.left) / rect.width * 960;
    const sy = (clientY - rect.top) / rect.height * 600;
    const cam = camera();
    return { x: cam.x + sx / cam.scale, y: cam.y + sy / cam.scale };
  }
  function camera() {
    if (!self) return { x: 0, y: 0, scale: 0.6 };
    const scale = Math.min(960 / arena.width, 600 / arena.height);
    const pos = renderPositions.get(self.id) || self;
    return { x: Math.max(0, Math.min(arena.width - 960/scale, pos.x - 480/scale)), y: Math.max(0, Math.min(arena.height - 600/scale, pos.y - 300/scale)), scale };
  }
  canvas.addEventListener("mousemove", e => { mouse = { ...toWorld(e.clientX, e.clientY), down: mouse.down }; });
  canvas.addEventListener("mousedown", e => { if (e.button === 0) { mouse.down = true; shoot(); } });
  window.addEventListener("mouseup", () => mouse.down = false);
  canvas.addEventListener("touchstart", e => { e.preventDefault(); const t=e.touches[0]; mouse={...toWorld(t.clientX,t.clientY),down:true}; shoot(); }, {passive:false});
  canvas.addEventListener("touchmove", e => { e.preventDefault(); const t=e.touches[0]; mouse={...toWorld(t.clientX,t.clientY),down:mouse.down}; }, {passive:false});
  canvas.addEventListener("touchend", () => mouse.down=false);
  function shoot() {
    if (!joined || !self) return;
    const angle = Math.atan2(mouse.y - self.y, mouse.x - self.x);
    socket.emit("shoot", { angle });
  }
  window.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," ","shift"].includes(k)) e.preventDefault();
    keys[k] = true;
    if (k === " " && !e.repeat) shoot();
  });
  window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);
  let last = performance.now(), lastShot = 0, lastInputAt = 0;
  function loop(now) {
    const dt = Math.min(.05, (now-last)/1000); last=now;
    const smooth = 1 - Math.exp(-dt * 18);
    for (const pos of renderPositions.values()) {
      if (Number.isFinite(pos.tx)) pos.x += (pos.tx - pos.x) * smooth;
      if (Number.isFinite(pos.ty)) pos.y += (pos.ty - pos.y) * smooth;
    }
    if (matchEndsAt && !matchEnded) {
      const remaining = Math.max(0, Math.ceil((matchEndsAt - Date.now()) / 1000));
      $("matchTimer").textContent = `${String(Math.floor(remaining / 60)).padStart(2,"0")}:${String(remaining % 60).padStart(2,"0")}`;
    } else if (matchEnded) $("matchTimer").textContent = "00:00";
    if (respawnAt && self && self.hp <= 0) {
      const seconds = Math.max(0, Math.ceil((respawnAt - Date.now()) / 1000));
      $("respawnNotice").textContent = seconds > 0 ? `RESPAWNING IN ${seconds}…` : "RESPAWNING…";
    }
    if (joined && self && !matchEnded && self.hp > 0) {
      const input = { up:keys.w||keys.arrowup, down:keys.s||keys.arrowdown, left:keys.a||keys.arrowleft, right:keys.d||keys.arrowright, dash:keys.shift, dt };
      input.angle = Math.atan2(mouse.y-self.y, mouse.x-self.x);
      if (now - lastInputAt >= 25) { socket.emit("input", input); lastInputAt = now; }
      if (mouse.down && now-lastShot > 260) { shoot(); lastShot=now; }
    }
    draw();
    requestAnimationFrame(loop);
  }
  function draw() {
    ctx.clearRect(0,0,960,600);
    ctx.fillStyle="#111624"; ctx.fillRect(0,0,960,600);
    if (!joined || !self) {
      ctx.fillStyle="#222940"; for(let x=0;x<960;x+=32)for(let y=0;y<600;y+=32){if((x/32+y/32)%2===0)ctx.fillRect(x,y,32,32);}
      return;
    }
    const cam = camera();
    ctx.save(); ctx.scale(cam.scale,cam.scale); ctx.translate(-cam.x,-cam.y);
    ctx.fillStyle="#151b2a"; ctx.fillRect(0,0,arena.width,arena.height);
    ctx.strokeStyle="#242d42"; ctx.lineWidth=1;
    for(let x=0;x<=arena.width;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,arena.height);ctx.stroke();}
    for(let y=0;y<=arena.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(arena.width,y);ctx.stroke();}
    // Decorative arena blocks
    ctx.fillStyle="#20283b";
    for(let x=120;x<arena.width;x+=280){ctx.fillRect(x,150,64,64);ctx.fillRect(x+100,arena.height-210,44,60);}
    ctx.strokeStyle="#48516b";ctx.lineWidth=4;ctx.strokeRect(4,4,arena.width-8,arena.height-8);
    for(const b of bullets){ctx.fillStyle=b.color||"#fff";ctx.fillRect(b.x-4,b.y-4,8,8);ctx.fillStyle="#ffffff88";ctx.fillRect(b.x-2,b.y-2,4,4);}
    for(const p of players) {
      const pos = renderPositions.get(p.id);
      drawPlayer(pos ? { ...p, x: pos.x, y: pos.y } : p);
    }
    ctx.restore();
    // Minimal minimap
    ctx.fillStyle="#0d111ddd";ctx.fillRect(790,14,154,96);
    ctx.strokeStyle="#424a64";ctx.strokeRect(790,14,154,96);
    for(const p of players){ctx.fillStyle=p.color;ctx.fillRect(798+p.x/arena.width*138,20+p.y/arena.height*82,4,4);}
    ctx.fillStyle="#9ba4be";ctx.font="9px monospace";ctx.fillText("ARENA MAP",800,104);
  }
  function drawPlayer(p) {
    const s=18;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle||0);
    ctx.fillStyle="#0008";ctx.fillRect(-s+4,-s+5,s*2,s*2);
    ctx.fillStyle=p.color;ctx.fillRect(-s,-s,s*2,s*2);
    ctx.fillStyle="#111624";ctx.fillRect(-s+5,-s+5,5,5);ctx.fillRect(3,-s+5,5,5);
    ctx.fillStyle="#f3f4ff";ctx.fillRect(5,-4,16,8);
    ctx.fillStyle="#111624";ctx.fillRect(14,-2,7,4);
    ctx.restore();
    ctx.fillStyle="#080b12";ctx.fillRect(p.x-25,p.y-34,50,5);
    ctx.fillStyle=p.hp<=35?"#ff6b8a":"#62e6a7";ctx.fillRect(p.x-25,p.y-34,50*Math.max(0,p.hp)/100,5);
    ctx.font="12px monospace";ctx.textAlign="center";ctx.fillStyle=p.id===myId?"#ffffff":"#c5cbe0";ctx.fillText(p.name,p.x,p.y-42);ctx.textAlign="left";
    if(p.id===myId){ctx.strokeStyle="#ffffff99";ctx.lineWidth=2;ctx.strokeRect(p.x-23,p.y-23,46,46);}
  }
  requestAnimationFrame(loop);
})();
