import type { GameRoomEntry, GameRoomSnapshot, GameRoomListing, GameRoomMode, WebSerialTransport } from "@tama-breed-poc/tama-protocol";
import { SerialBridge } from "../serial-bridge";
import { Tet3Observer } from "./tet3";
import { games, gameId, modeAdvice } from "./catalog";
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
interface Hooks { serial(): WebSerialTransport | undefined; game(): string; busy(): boolean; changed(): void; adapterLost(): void; }
/** Shared room presentation. Hosted rounds belong to the server; direct rounds
 * belong to the toys. SerialBridge owns UART in both modes. */
export class GameRoom {
  private entry: GameRoomEntry | undefined;
  private snapshot: GameRoomSnapshot | undefined;
  private ws: WebSocket | undefined;
  private bridge: SerialBridge | undefined;
  private available = false;
  private busy = false;
  private generation = 0;
  private connectingAdapter = false;
  private readonly toyObserver = new Tet3Observer();
  private readonly peerObserver = new Tet3Observer();
  private toyMode: number | undefined;
  private directRound = 0;
  private directPlayer: number | undefined;
  private directResult = "Waiting";
  private selection = el<HTMLSelectElement>("match-kind");
  constructor(private readonly base: string, private readonly hooks: Hooks) {
    try { el<HTMLInputElement>("group-nickname").value = localStorage.getItem("game-nickname") ?? localStorage.getItem("playdate-nickname") ?? ""; } catch { /* Optional nickname persistence. */ }
    this.selection.addEventListener("change", () => { this.render(); hooks.changed(); if (!this.active) void this.refresh(); });
    el("group-create").addEventListener("click", () => void this.run(async () => {
      const entry = await this.api<GameRoomEntry>("/game-rooms", { nickname: this.nickname(), game: hooks.game(),
        visibility: el<HTMLInputElement>("group-public").checked ? "public" : "private", mode: this.mode });
      this.enter(entry);
    }));
    el("group-join").addEventListener("click", () => void this.join(el<HTMLInputElement>("group-code-input").value));
    el("group-refresh").addEventListener("click", () => void this.refresh());
    el("group-leave").addEventListener("click", () => void this.run(async () => {
      if (!this.entry) return;
      await this.api(`/game-rooms/${this.entry.code}/leave`, { token: this.entry.token });
      this.clear(); this.status("You left the room. Your adapter can stay connected."); await this.refresh();
    }));
    el("group-copy-code").addEventListener("click", () => {
      if (this.entry) this.copy(this.entry.code, "Room code copied.");
    });
    el("group-copy").addEventListener("click", () => {
      if (!this.entry) return;
      const url = new URL(location.href); url.searchParams.set("game", this.entry.game); url.searchParams.set("mode", this.mode); url.searchParams.set("room", this.entry.code);
      this.copy(url.href, "Invite link copied.");
    });
    el("group-action").addEventListener("click", () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { if (this.entry) this.enter(this.entry); return; }
      const own = this.self();
      if (this.mode === "direct") {
        if (own?.reason && this.hooks.serial()) { this.releaseAdapter(); this.syncAdapter(true); }
      } else if (this.snapshot?.match) {
        if (["results", "aborted"].includes(this.snapshot.match.phase)) this.send({ type: "reset" });
      } else if (own?.reason && !own.toyReady && this.hooks.serial()) {
        this.releaseAdapter(); this.syncAdapter(true);
      } else if (!own?.ready) this.send({ type: "ready", ready: true });
      else if (this.snapshot?.owner === this.entry?.memberId) this.send({ type: "start" });
    });
    el("group-unready").addEventListener("click", () => this.send({ type: "ready", ready: false }));
  }
  private get mode(): GameRoomMode { return this.entry ? this.entry.mode ?? "hosted" : this.selection.value === "hosted" ? "hosted" : "direct"; }
  get active() { return !!this.entry; }
  async initialize() {
    try {
      const capabilities = await this.api<{ modes?: string[] }>("/game-rooms"); this.available = true;
      const invite = new URL(location.href);
      if (invite.searchParams.get("mode") === "hosted" || !capabilities.modes?.includes("direct")) this.selection.value = "hosted";
      this.selection.options[0]!.disabled = !capabilities.modes?.includes("direct");
      el<HTMLInputElement>("group-code-input").value = invite.searchParams.get("room") ?? "";
      let saved: GameRoomEntry | null = null;
      try { saved = JSON.parse(sessionStorage.getItem("hosted-game-room") ?? "null"); } catch { /* Optional reconnect storage. */ }
      if (saved?.game === this.hooks.game() && /^[A-Z0-9]{6}$/.test(saved.code) && /^[a-f0-9]{64}$/.test(saved.token)) {
        this.selection.value = saved.mode ?? "hosted"; this.enter(saved);
      }
      this.update(); if (!this.active) await this.refresh();
    } catch { this.status("Game rooms are unavailable. Refresh to try again."); this.render(); }
  }
  gameChanged() { if (!this.active && this.available) void this.refresh(); }
  update() { this.syncAdapter(); this.render(); }
  adapterConnected() { this.syncAdapter(true); this.render(); }
  releaseAdapter() {
    this.bridge?.stop(); this.bridge = undefined; this.connectingAdapter = false;
    this.toyObserver.reset(); this.toyMode = undefined;
    this.peerObserver.reset(); this.directRound = 0; this.directPlayer = undefined; this.directResult = "Waiting";
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ type: "adapter", connected: false });
  }
  close() { ++this.generation; this.bridge?.stop(); this.ws?.close(); this.bridge = undefined; this.ws = undefined; this.toyObserver.reset(); this.peerObserver.reset(); this.toyMode = undefined; this.directRound = 0; this.directPlayer = undefined; this.directResult = "Waiting"; }
  private clear() {
    this.close(); this.entry = undefined; this.snapshot = undefined; this.connectingAdapter = false;
    try { sessionStorage.removeItem("hosted-game-room"); } catch { /* Optional reconnect storage. */ }
    const url = new URL(location.href); url.searchParams.delete("room"); history.replaceState(null, "", url);
    this.render(); this.hooks.changed();
  }
  private async api<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(this.base + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not reach the room."); return data;
  }
  private nickname() {
    const input = el<HTMLInputElement>("group-nickname"), name = input.value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
    if (!name || [...name].length > 20) { input.focus(); throw new Error("Choose a nickname of 1–20 characters."); }
    try { localStorage.setItem("game-nickname", name); } catch { /* Optional convenience. */ }
    return name;
  }
  private self() { return this.snapshot?.members.find(m => m.id === this.entry?.memberId); }
  private send(control: object) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(control)); }
  private copy(text: string, message: string) {
    void navigator.clipboard.writeText(text).then(() => this.status(message), () => this.status("Copy the room code shown above."));
  }
  private status(text: string) { el("group-status").textContent = text; }
  private async run(action: () => Promise<void>) {
    if (this.busy || this.hooks.busy()) return; this.busy = true; this.render();
    try { await action(); } catch (e) { this.status(e instanceof Error ? e.message : "Room request failed."); }
    finally { this.busy = false; this.render(); this.hooks.changed(); }
  }
  private async join(code: string) {
    await this.run(async () => {
      const input = code.trim().toUpperCase(); if (!/^[A-Z0-9]{6}$/.test(input)) throw new Error("Enter a six-character room code.");
      this.enter(await this.api<GameRoomEntry>(`/game-rooms/${input}/join`, { nickname: this.nickname(), game: this.hooks.game(), mode: this.mode }));
    });
  }
  private async refresh() {
    try {
      const { rooms } = await this.api<{ rooms: GameRoomListing[] }>("/game-rooms");
      const list = el("group-list"); list.replaceChildren();
      for (const room of rooms.filter(r => r.game === this.hooks.game())) {
        const button = document.createElement("button"); button.className = "secondary";
        button.textContent = `${room.nickname}’s room · ${room.mode === "direct" ? "Versus" : "Online"} · ${room.count}/${room.capacity}`;
        button.addEventListener("click", () => { this.selection.value = room.mode ?? "hosted"; this.render(); void this.join(room.code); }); list.append(button);
      }
      if (!list.childElementCount) list.textContent = "No open rooms yet. Make one and invite your friends.";
    } catch (e) { this.status(e instanceof Error ? e.message : "Could not refresh rooms."); }
  }
  private enter(entry: GameRoomEntry) {
    this.close(); this.entry = entry; this.snapshot = undefined; this.connectingAdapter = false;
    this.selection.value = entry.mode ?? "hosted";
    try { sessionStorage.setItem("hosted-game-room", JSON.stringify(entry)); } catch { /* Room works without persistent reconnect. */ }
    const generation = ++this.generation;
    const url = new URL(`/game-ws/${entry.code}`, this.base); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, entry.token); this.ws = ws;
    this.status("Connecting to your room…"); this.render(); this.hooks.changed();
    ws.addEventListener("open", () => { if (generation === this.generation) { this.render(); } });
    ws.addEventListener("message", event => {
      if (generation !== this.generation || typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "error") { this.status(data.message); return; }
        if (data.type !== "game-room" || data.code !== entry.code || data.game !== entry.game) return;
        const previous = this.snapshot; this.snapshot = data;
        if (this.mode === "direct" && this.bridge && !this.connectingAdapter && previous?.members.find(m => m.id === this.entry?.memberId)?.adapter && this.self()?.reason && !this.self()?.adapter) {
          this.bridge.stop(); this.bridge = undefined; this.directResult = "Disconnected";
        }
        if (this.self()?.adapter) this.connectingAdapter = false;
        if (!previous) this.status("");
        // A reset deliberately ends all old toy sessions. Wait for the player's
        // explicit reconnect after returning their toy to its Online menu.
        if (previous?.match && !this.snapshot?.match) { this.bridge?.stop(); this.bridge = undefined; }
        if (!previous) this.syncAdapter();
        this.render();
      } catch { this.status("Could not read the room update. Reconnect to try again."); }
    });
    ws.addEventListener("close", () => {
      if (generation !== this.generation) return;
      this.bridge?.stop(); this.bridge = undefined; this.connectingAdapter = false;
      this.status("Room connection closed. Reconnect to see its status; an interrupted match cannot resume."); this.render();
    });
    ws.addEventListener("error", () => { if (generation === this.generation) this.status("Could not connect to the room."); });
  }
  private syncAdapter(force = false) {
    const serial = this.hooks.serial(), ws = this.ws;
    if (!serial || !ws || ws.readyState !== WebSocket.OPEN || this.bridge || this.connectingAdapter || this.snapshot?.match) return;
    // After a completed/failed match the player explicitly reconnects once.
    if (this.self()?.reason && !force) return;
    this.connectingAdapter = true; this.toyObserver.reset(); this.toyMode = undefined;
    this.peerObserver.reset(); this.directRound = 0; this.directPlayer = undefined; this.directResult = "Waiting";
    this.bridge = new SerialBridge(serial, ws, { error: () => { this.releaseAdapter(); this.hooks.adapterLost(); this.status("Adapter connection lost. Reconnect your Paradise above."); },
      bytes: (direction, bytes, stats) => {
        el("traffic").textContent = `${stats.bytesOut} bytes sent · ${stats.bytesIn} received`;
        let changed = false;
        for (const packet of (direction === "out" ? this.toyObserver : this.peerObserver).push(bytes)) {
          if (direction === "out" && packet.type === 1 && !packet.session && !packet.sequence && !packet.round && packet.a && this.toyMode !== packet.b) {
            this.toyMode = packet.b; changed = true;
          }
          if (this.mode !== "direct") continue;
          if (packet.type === 1 && !packet.session && !packet.sequence) { this.directRound = 0; this.directResult = "Connecting"; changed = true; }
          if (packet.round < this.directRound) continue;
          if (packet.type === 4) { this.directRound = packet.round; this.directPlayer = direction === "out" ? 0 : packet.b >>> 8; this.directResult = "Get ready"; changed = true; }
          if (packet.type === 5) { this.directResult = "Playing"; changed = true; }
          if ((packet.type === 9 || packet.type === 10) && this.directPlayer !== undefined && this.directPlayer < 2) {
            const peer = this.snapshot?.members.find(m => m.id !== this.entry?.memberId)?.nickname ?? "Friend";
            this.directResult = `You ${(packet.b >>> (this.directPlayer * 2)) & 3} · ${peer} ${(packet.b >>> ((this.directPlayer ^ 1) * 2)) & 3}${packet.type === 10 ? " · Finished" : ""}`; changed = true;
          }
          if (packet.type === 12 || packet.type === 15) { this.directResult = "Disconnected"; changed = true; }
        }
        if (changed) this.render();
      } });
    this.bridge.start(); this.send({ type: "adapter", connected: true });
  }
  private render() {
    const supported = this.available;
    el("match-kind-field").hidden = !supported;
    this.selection.disabled = this.active || this.hooks.busy();
    el("direct-scoreboard").hidden = this.mode !== "direct" || !this.active;
    el("toy-mode-hint").textContent = this.mode === "hosted"
      ? "Group room · 2–16 players. Choose Online on your toy after joining."
      : "Direct room · two players. Choose Versus on both toys after your friend joins.";
    el("match-footer").textContent = `${this.mode === "hosted" ? "2–16 players" : "Two players"} · first to two wins. Keep this page open while you play.`;
    el("group-entry").hidden = this.active; el("group-current").hidden = !this.active;
    for (const id of ["group-create", "group-join", "group-leave", "group-refresh"]) el<HTMLButtonElement>(id).disabled = !this.available || this.busy || this.hooks.busy();
    if (!this.entry) return;
    el("group-code").textContent = this.entry.code;
    const own = this.self(), snap = this.snapshot, match = snap?.match;
    const owner = snap?.members.find(m => m.id === snap.owner)?.nickname ?? "Your friend";
    el("group-title").textContent = `${owner}’s ${games[gameId(this.hooks.game())].title} room`;
    el("group-visibility").textContent = `${snap?.visibility === "public" ? "Public" : "Private"} · ${this.mode === "direct" ? "Versus · 2 players" : "Online · 2–16 players"}`;
    const players = el("group-players"); players.replaceChildren();
    for (const member of snap?.members ?? []) {
      const item = document.createElement("li"), name = document.createElement("strong"), detail = document.createElement("span");
      name.textContent = member.nickname + (member.id === this.entry.memberId ? " · you" : "");
      const seat = match?.players.find(p => p.id === member.id);
      detail.textContent = seat ? `${seat.wins} ${seat.wins === 1 ? "win" : "wins"} · ${!seat.connected ? "disconnected" : seat.alive ? "in play" : "waiting"}` :
        !member.connected ? "offline" : member.ready ? "ready" : member.toyReady ? "toy connected" : member.adapter ? this.mode === "direct" ? "adapter connected" : "waiting for Online" : "connect toy";
      item.append(name, detail); players.append(item);
    }
    const action = el<HTMLButtonElement>("group-action"); action.disabled = true; action.hidden = false;
    el("group-unready").hidden = !own?.ready || !!match;
    const instruction = el("group-instruction");
    if (this.ws?.readyState !== WebSocket.OPEN) { action.textContent = "Reconnect room"; action.disabled = false; return; }
    if (this.mode === "direct") {
      const peer = snap?.members.find(m => m.id !== this.entry?.memberId);
      const advice = modeAdvice(gameId(this.hooks.game()), false, this.toyMode);
      instruction.textContent = advice ?? own?.reason ?? (!this.hooks.serial() ? "Connect your Paradise above."
        : !peer?.connected ? "Waiting for your friend to join. Keep your toy on the game menu."
        : !peer.adapter ? `${peer.nickname} is connecting their Paradise. Keep your toy on the game menu.`
        : this.directResult === "Get ready" ? `Connected to ${peer.nickname}. The round is starting on your toys…`
        : this.directResult === "Playing" ? `Round ${this.directRound} · playing with ${peer.nickname}.`
        : this.directResult.endsWith("Finished") ? "Match finished. Both press B on the toy for a rematch, or C to return to the menu."
        : `You and ${peer.nickname}: choose Versus on your toys. If already waiting, press C and choose Versus again. The match starts on the toys.`);
      action.hidden = !own?.reason || !this.hooks.serial() || !!advice;
      action.textContent = "Reconnect toy"; action.disabled = false;
      el("group-unready").hidden = true;
      el("round").textContent = this.directRound ? String(this.directRound) : "—";
      el("match").textContent = this.directResult;
      return;
    }
    action.hidden = false;
    if (!match) {
      const advice = !own?.toyReady ? modeAdvice(gameId(this.hooks.game()), true, this.toyMode) : undefined;
      instruction.textContent = advice ?? own?.reason ?? "On your Paradise, choose Online from the game menu. When your toy connects, mark yourself ready.";
      if (!this.hooks.serial()) action.textContent = "Connect Paradise above";
      else if (advice) action.textContent = "Choose Online on your toy";
      else if (own?.reason && !own.toyReady) { action.textContent = "Reconnect toy"; action.disabled = false; }
      else if (!own?.toyReady) action.textContent = "Choose Online on your toy";
      else if (!own.ready) { action.textContent = "I’m ready"; action.disabled = false; }
      else if (snap?.owner === this.entry.memberId) {
        action.textContent = "Start match"; action.disabled = !snap.canStart;
      } else action.textContent = "Ready · waiting for the host";
    } else {
      const me = match.players.find(p => p.id === this.entry!.memberId);
      const target = snap?.members.find(m => m.id === match.players[me?.target ?? -1]?.id)?.nickname;
      const winner = snap?.members.find(m => m.id === match.players[match.winner ?? -1]?.id)?.nickname;
      const remaining = match.players.filter(p => p.alive).length;
      if (match.phase === "preparing") instruction.textContent = "Getting every toy ready…";
      else if (match.phase === "countdown") instruction.textContent = `Starting in ${Math.ceil((snap?.countdownMs ?? 0) / 1000)}…`;
      else if (match.phase === "playing") instruction.textContent = `Round ${match.round} · ${remaining} remaining${me?.alive && target ? ` · Your next target: ${target}` : " · Watch the round"}`;
      else instruction.textContent = match.reason ?? (match.winner === 255 ? "Round tied." : `${winner ?? "Your friend"} wins${match.phase === "results" ? " the match" : " the round"}!`);
      if (["results", "aborted"].includes(match.phase)) {
        action.textContent = "Open next match"; action.disabled = snap?.owner !== this.entry.memberId;
        instruction.textContent += " Return to the game menu before joining the next match.";
      } else action.textContent = "Play on your Paradise";
    }
  }
}
