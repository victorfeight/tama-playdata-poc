import type { GameRoomEntry, GameRoomSnapshot, GameRoomListing, WebSerialTransport } from "@tama-breed-poc/tama-protocol";
import { SerialBridge } from "../serial-bridge";
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
interface Hooks { serial(): WebSerialTransport | undefined; game(): string; busy(): boolean; changed(): void; }
/** Thin room presentation. The server owns rounds; SerialBridge owns UART. */
export class HostedGameRoom {
  private entry: GameRoomEntry | undefined;
  private snapshot: GameRoomSnapshot | undefined;
  private ws: WebSocket | undefined;
  private bridge: SerialBridge | undefined;
  private available = false;
  private busy = false;
  private generation = 0;
  private connectingAdapter = false;
  private selection = el<HTMLSelectElement>("match-kind");
  constructor(private readonly base: string, private readonly hooks: Hooks) {
    this.selection.addEventListener("change", () => { this.render(); hooks.changed(); if (this.selected) void this.refresh(); });
    el("group-create").addEventListener("click", () => void this.run(async () => {
      const entry = await this.api<GameRoomEntry>("/game-rooms", { nickname: this.nickname(), game: hooks.game(),
        visibility: el<HTMLInputElement>("group-public").checked ? "public" : "private" });
      this.enter(entry);
    }));
    el("group-join").addEventListener("click", () => void this.join(el<HTMLInputElement>("group-code-input").value));
    el("group-refresh").addEventListener("click", () => void this.refresh());
    el("group-leave").addEventListener("click", () => void this.run(async () => {
      if (!this.entry) return;
      await this.api(`/game-rooms/${this.entry.code}/leave`, { token: this.entry.token });
      this.clear(); this.status("You left the room. Your adapter can stay connected."); await this.refresh();
    }));
    el("group-copy").addEventListener("click", () => {
      if (!this.entry) return;
      const url = new URL(location.href); url.searchParams.set("mode", "hosted"); url.searchParams.set("room", this.entry.code);
      void navigator.clipboard.writeText(url.href).then(() => this.status("Invite link copied."), () => this.status("Share the room code shown above."));
    });
    el("group-action").addEventListener("click", () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { if (this.entry) this.enter(this.entry); return; }
      const own = this.self();
      if (this.snapshot?.match) {
        if (["results", "aborted"].includes(this.snapshot.match.phase)) this.send({ type: "reset" });
      } else if (own?.reason && !own.toyReady && this.hooks.serial()) {
        this.releaseAdapter(); this.syncAdapter(true);
      } else if (!own?.ready) this.send({ type: "ready", ready: true });
      else if (this.snapshot?.owner === this.entry?.memberId) this.send({ type: "start" });
    });
    el("group-unready").addEventListener("click", () => this.send({ type: "ready", ready: false }));
  }
  get selected() { return this.available && this.selection.value === "hosted"; }
  get active() { return !!this.entry; }
  async initialize() {
    try {
      await this.api("/game-rooms"); this.available = true;
      const invite = new URL(location.href);
      if (invite.searchParams.get("mode") === "hosted") this.selection.value = "hosted";
      el<HTMLInputElement>("group-code-input").value = invite.searchParams.get("room") ?? "";
      const saved = JSON.parse(sessionStorage.getItem("hosted-game-room") ?? "null") as GameRoomEntry | null;
      if (saved?.game === this.hooks.game() && /^[A-Z0-9]{6}$/.test(saved.code) && /^[a-f0-9]{64}$/.test(saved.token)) {
        this.selection.value = "hosted"; this.enter(saved);
      }
      this.update(); if (this.selected && !this.active) await this.refresh();
    } catch { /* An older server has no hosted API. Preserve the direct game. */ }
  }
  update() { this.syncAdapter(); this.render(); }
  releaseAdapter() {
    this.bridge?.stop(); this.bridge = undefined; this.connectingAdapter = false;
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ type: "adapter", connected: false });
  }
  close() { ++this.generation; this.bridge?.stop(); this.ws?.close(); this.bridge = undefined; this.ws = undefined; }
  private clear() {
    this.close(); this.entry = undefined; this.snapshot = undefined; this.connectingAdapter = false;
    sessionStorage.removeItem("hosted-game-room");
    const url = new URL(location.href); url.searchParams.delete("room"); history.replaceState(null, "", url);
    this.render(); this.hooks.changed();
  }
  private async api<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(this.base + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not reach the room."); return data;
  }
  private nickname() { return el<HTMLInputElement>("group-nickname").value.trim(); }
  private self() { return this.snapshot?.members.find(m => m.id === this.entry?.memberId); }
  private send(control: object) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(control)); }
  private status(text: string) { el("group-status").textContent = text; }
  private async run(action: () => Promise<void>) {
    if (this.busy || this.hooks.busy()) return; this.busy = true; this.render();
    try { await action(); } catch (e) { this.status(e instanceof Error ? e.message : "Room request failed."); }
    finally { this.busy = false; this.render(); this.hooks.changed(); }
  }
  private async join(code: string) {
    await this.run(async () => {
      const input = code.trim().toUpperCase(); if (!/^[A-Z0-9]{6}$/.test(input)) throw new Error("Enter a six-character room code.");
      this.enter(await this.api<GameRoomEntry>(`/game-rooms/${input}/join`, { nickname: this.nickname(), game: this.hooks.game() }));
    });
  }
  private async refresh() {
    try {
      const { rooms } = await this.api<{ rooms: GameRoomListing[] }>("/game-rooms");
      const list = el("group-list"); list.replaceChildren();
      for (const room of rooms.filter(r => r.game === this.hooks.game())) {
        const button = document.createElement("button"); button.className = "secondary";
        button.textContent = `${room.nickname}’s room · ${room.count}/${room.capacity}`;
        button.addEventListener("click", () => void this.join(room.code)); list.append(button);
      }
      if (!list.childElementCount) list.textContent = "No open rooms yet. Make one and invite your friends.";
    } catch (e) { this.status(e instanceof Error ? e.message : "Could not refresh rooms."); }
  }
  private enter(entry: GameRoomEntry) {
    this.close(); this.entry = entry; this.snapshot = undefined; this.connectingAdapter = false;
    sessionStorage.setItem("hosted-game-room", JSON.stringify(entry));
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
    this.connectingAdapter = true;
    this.bridge = new SerialBridge(serial, ws, { error: () => { this.releaseAdapter(); this.status("Adapter connection lost. Reconnect your Paradise above."); },
      bytes: (_direction, _bytes, stats) => { el("traffic").textContent = `${stats.bytesOut} bytes sent · ${stats.bytesIn} received`; } });
    this.bridge.start(); this.send({ type: "adapter", connected: true }); this.connectingAdapter = false;
  }
  private render() {
    const supported = this.available;
    el("match-kind-field").hidden = !supported;
    this.selection.disabled = this.active || this.hooks.busy();
    el("direct-room").hidden = this.selected; el("group-room").hidden = !this.selected;
    el("direct-scoreboard").hidden = this.selected;
    el("match-footer").textContent = `${this.selected ? "2–16 players" : "Two players"} · first to two wins. Keep this page open while you play.`;
    el("group-entry").hidden = this.active; el("group-current").hidden = !this.active;
    for (const id of ["group-create", "group-join", "group-leave", "group-refresh"]) el<HTMLButtonElement>(id).disabled = this.busy || this.hooks.busy();
    if (!this.entry) return;
    el("group-code").textContent = this.entry.code;
    const own = this.self(), snap = this.snapshot, match = snap?.match;
    const players = el("group-players"); players.replaceChildren();
    for (const member of snap?.members ?? []) {
      const item = document.createElement("li"), name = document.createElement("strong"), detail = document.createElement("span");
      name.textContent = member.nickname + (member.id === this.entry.memberId ? " · you" : "");
      const seat = match?.players.find(p => p.id === member.id);
      detail.textContent = seat ? `${seat.wins} ${seat.wins === 1 ? "win" : "wins"} · ${!seat.connected ? "disconnected" : seat.alive ? "in play" : "waiting"}` :
        !member.connected ? "offline" : member.ready ? "ready" : member.toyReady ? "toy connected" : member.adapter ? "waiting for Online" : "connect toy";
      item.append(name, detail); players.append(item);
    }
    const action = el<HTMLButtonElement>("group-action"); action.disabled = true;
    el("group-unready").hidden = !own?.ready || !!match;
    const instruction = el("group-instruction");
    if (this.ws?.readyState !== WebSocket.OPEN) { action.textContent = "Reconnect room"; action.disabled = false; return; }
    if (!match) {
      instruction.textContent = own?.reason ?? "On your Paradise, choose Online from the game menu. When your toy connects, mark yourself ready.";
      if (!this.hooks.serial()) action.textContent = "Connect Paradise above";
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
