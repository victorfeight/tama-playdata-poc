import type { LobbyEntry, LobbyListing, LobbySnapshot } from "@tama-breed-poc/tama-protocol";
import { LobbyClient } from "../lobby-client";
import { bindNickname, readNickname } from "./nickname";

interface Hooks {
  socket(socket: WebSocket | undefined): void;
  peerChanged(): void;
}

/** Shared Playdate/Gift presentation around shared room membership. UART stays in main. */
export class StockLobby {
  private entry: LobbyEntry | undefined;
  private socket: WebSocket | undefined;
  private snapshot: LobbySnapshot | undefined;
  private adapter = false;
  private busy = false;
  private listingPending = false;
  private peerSignature = "";
  private readyUntil = 0;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private showStartWindow = false;
  private rooms: LobbyListing[] = [];
  private readonly nickname = element<HTMLInputElement>("nickname");
  private readonly code = element<HTMLInputElement>("room-code");
  private readonly status = element("lobby-status");

  constructor(private readonly client: LobbyClient, private readonly hooks: Hooks) {
    try {
      this.nickname.value = localStorage.getItem(`${client.activity}-nickname`) ?? "";
      const saved = JSON.parse(sessionStorage.getItem(`${client.activity}-lobby`) ?? "null");
      if (saved && /^[A-Z0-9]{6}$/.test(saved.code) && /^[a-f0-9]{64}$/.test(saved.token) && typeof saved.memberId === "string") this.entry = saved;
    } catch { /* A blocked or old storage entry does not prevent joining. */ }
    const invite = new URLSearchParams(location.search).get("room");
    if (invite && /^[A-Z0-9]{6}$/i.test(invite)) this.code.value = invite.toUpperCase();
    bindNickname(this.nickname);
    element("create-room").addEventListener("click", () => void this.run(async () => {
      this.entry = await client.create(this.name(), element<HTMLInputElement>("public-room").checked ? "public" : "private");
      await this.connect();
    }));
    element("join-form").addEventListener("submit", event => {
      event.preventDefault(); void this.join(this.code.value.trim().toUpperCase());
    });
    element("leave-room").addEventListener("click", () => void this.run(async () => {
      const entry = this.entry;
      if (!entry) return;
      // Keep the credential until leave succeeds, so retry cannot strand a seat.
      await client.leave(entry);
      this.clear();
      this.status.textContent = "You left the room. Your adapter can stay connected.";
      void this.refresh();
    }));
    element("reconnect-room").addEventListener("click", () => void this.run(() => this.connect()));
    element("start-me").addEventListener("click", () => this.chooseStarter(true));
    element("start-friend").addEventListener("click", () => this.chooseStarter(false));
    element("start-prompt").addEventListener("click", () => {
      if (!this.snapshot?.canChooseStarter || this.socket?.readyState !== WebSocket.OPEN) return;
      this.socket.send(JSON.stringify({ type: "start-prompt", action: this.snapshot.starterId === this.entry?.memberId ? "prepare" : "ready" }));
    });
    element("refresh-rooms").addEventListener("click", () => void this.refresh());
    element("copy-room").addEventListener("click", () => void this.run(async () => {
      if (!this.entry) return;
      const invite = new URL(location.href);
      invite.search = ""; invite.hash = ""; invite.searchParams.set("room", this.entry.code);
      try {
        await navigator.clipboard.writeText(invite.href);
        this.status.textContent = "Invite link copied. Share it with your friend.";
      } catch {
        this.status.textContent = `Share room code ${this.entry.code} with your friend.`;
      }
    }));
    element("copy-code").addEventListener("click", () => void this.run(async () => {
      if (!this.entry) return;
      try { await navigator.clipboard.writeText(this.entry.code); this.status.textContent = "Room code copied."; }
      catch { this.status.textContent = `Your room code is ${this.entry.code}.`; }
    }));
    this.render();
    if (this.entry) void this.run(() => this.connect());
    else void this.refresh();
    // Quiet refresh only while browsing; no live region chatter or focus loss.
    setInterval(() => { if (!document.hidden && !this.entry) void this.refresh(); }, 15_000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.render(); });
  }

  get roomCode(): string | undefined { return this.entry?.code; }
  get role(): "host" | "guest" | undefined {
    const me = this.snapshot?.members.find(m => m.id === this.entry?.memberId);
    return me ? me.slot === 0 ? "host" : "guest" : undefined;
  }
  setAdapter(connected: boolean): void {
    if (this.adapter === connected) return;
    this.adapter = connected;
    this.sendAdapter();
    this.render();
  }

  private name(): string {
    const value = readNickname(this.nickname);
    try { localStorage.setItem(`${this.client.activity}-nickname`, value); } catch { /* Optional convenience. */ }
    return value;
  }

  private async join(code: string): Promise<void> {
    await this.run(async () => {
      if (!/^[A-Z0-9]{6}$/.test(code)) { this.code.focus(); throw new Error("Enter the six-character room code."); }
      this.entry = await this.client.join(code, this.name());
      await this.connect();
    });
  }

  private async connect(): Promise<void> {
    if (!this.entry) return;
    const old = this.socket;
    this.socket = undefined;
    old?.close();
    this.hooks.socket(undefined);
    this.peerSignature = "";
    this.snapshot = undefined;
    try { sessionStorage.setItem(`${this.client.activity}-lobby`, JSON.stringify(this.entry)); } catch { /* No persistent reconnect. */ }
    const ws = this.client.connect(this.entry);
    this.socket = ws;
    this.status.textContent = "Joining your room…";
    this.render();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error("Could not reach the room. Try reconnecting.")); }, 10_000);
      ws.addEventListener("open", () => {
        if (this.socket !== ws) return;
        this.hooks.socket(ws);
        this.sendAdapter();
      });
      ws.addEventListener("message", event => {
        if (this.socket !== ws || typeof event.data !== "string") return;
        let update: LobbySnapshot;
        try { update = JSON.parse(event.data); } catch { return; }
        if (update.type !== "lobby" || update.code !== this.entry?.code) return;
        if (update.activity !== this.client.activity) { ws.close(); reject(new Error("This room is for another activity.")); return; }
        const wasReady = this.snapshot?.startPrompt === "ready";
        this.snapshot = update;
        const remaining = Math.max(0, Math.min(8000, update.readyForMs ?? 0));
        const deadline = performance.now() + remaining;
        // Repeated snapshots cannot restart or extend the same confirmation.
        // This is a human coordination window, not a firmware failure timeout.
        this.readyUntil = update.startPrompt === "ready" ? wasReady ? Math.min(this.readyUntil, deadline) : deadline : 0;
        const peer = update.members.find(m => m.id !== this.entry?.memberId);
        const signature = peer ? `${peer.id}:${peer.connection}:${peer.connected}:${peer.adapterConnected}` : "";
        if (signature !== this.peerSignature) { this.peerSignature = signature; this.hooks.peerChanged(); }
        this.status.textContent = "";
        this.render();
        clearTimeout(timeout); resolve();
      });
      ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Could not reach the room. Try reconnecting.")); });
      ws.addEventListener("close", event => {
        clearTimeout(timeout);
        if (this.socket !== ws) return;
        this.socket = undefined;
        this.hooks.socket(undefined);
        this.hooks.peerChanged();
        if (event.code === 4404) {
          this.clear();
          this.status.textContent = "That room has expired. Create a new room or join another.";
          void this.refresh();
        } else {
          this.status.textContent = event.code === 4001 ? "Your room was opened in another tab. Continue there or reconnect here."
            : "Room connection lost. Reconnect to try again; keep your toy on the normal menu for now.";
          this.render();
        }
        reject(new Error(this.status.textContent ?? "Room closed."));
      });
    });
    element("active-code").focus({ preventScroll: true });
  }

  private sendAdapter(): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "adapter", connected: this.adapter, starterChoice: true }));
  }

  private chooseStarter(me: boolean): void {
    if (!this.snapshot?.canChooseStarter || this.socket?.readyState !== WebSocket.OPEN) return;
    const member = this.snapshot.members.find(m => (m.id === this.entry?.memberId) === me);
    if (member && member.id !== this.snapshot.starterId)
      this.socket.send(JSON.stringify({ type: "starter", memberId: member.id }));
    // Render only the server's shared assignment, never an optimistic local flip.
  }

  private clear(): void {
    const ws = this.socket;
    this.socket = undefined; this.entry = undefined; this.snapshot = undefined;
    ws?.close();
    this.hooks.socket(undefined); this.hooks.peerChanged();
    try { sessionStorage.removeItem(`${this.client.activity}-lobby`); } catch { /* Optional storage. */ }
    this.peerSignature = "";
    this.render();
    this.nickname.focus();
  }

  private async refresh(): Promise<void> {
    if (this.listingPending || this.entry) return;
    this.listingPending = true;
    element<HTMLButtonElement>("refresh-rooms").disabled = true;
    try {
      const rooms = await this.client.list();
      if (this.entry) return;
      if (JSON.stringify(rooms) !== JSON.stringify(this.rooms)) {
        this.rooms = rooms;
        const list = element("public-rooms");
        list.replaceChildren(...rooms.map(room => {
          const row = document.createElement("li"); row.className = "room-listing";
          const name = document.createElement("span"); name.textContent = room.nickname;
          const label = document.createElement("small"); label.textContent = this.client.activity === "gift" ? "Ready to exchange gifts" : "Looking for a Playdate";
          const text = document.createElement("div"); text.append(name, label);
          const join = document.createElement("button"); join.type = "button"; join.className = "secondary";
          join.textContent = "Join"; join.setAttribute("aria-label", `Join ${room.nickname}’s room`);
          join.disabled = this.busy;
          join.addEventListener("click", () => void this.join(room.code));
          row.append(text, join); return row;
        }));
      }
      element("rooms-empty").hidden = rooms.length > 0;
      element("rooms-empty").textContent = "No open rooms just yet. Create one and invite someone to join.";
    } catch {
      if (!this.entry) {
        element("rooms-empty").hidden = false;
        element("rooms-empty").textContent = "Couldn’t refresh rooms. Try again in a moment.";
      }
    } finally {
      this.listingPending = false;
      element<HTMLButtonElement>("refresh-rooms").disabled = false;
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.status.textContent = ""; this.render();
    try { await action(); }
    catch (error) { this.status.textContent = error instanceof Error ? error.message : "Could not connect. Please try again."; }
    finally { this.busy = false; this.render(); }
  }

  private render(): void {
    const activityName = this.client.activity === "gift" ? "Gift" : "Playdate";
    const inRoom = !!this.entry;
    const online = this.socket?.readyState === WebSocket.OPEN && !!this.snapshot;
    element("lobby-entry").hidden = inRoom;
    element("room-panel").hidden = !inRoom;
    element("room-browser").hidden = inRoom;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-room-action], #public-rooms button")) button.disabled = this.busy;
    element("reconnect-room").hidden = !!online || this.socket?.readyState === WebSocket.CONNECTING;
    element("active-code").textContent = this.entry?.code ?? "";
    element("room-visibility").textContent = this.snapshot?.visibility === "public" ? "Public room" : "Private room";
    const me = this.snapshot?.members.find(m => m.id === this.entry?.memberId);
    const peer = this.snapshot?.members.find(m => m.id !== this.entry?.memberId);
    const iStart = this.snapshot?.starterId ? this.snapshot.starterId === me?.id : this.role === "guest";
    element("starter-choice").hidden = !online || !this.snapshot?.canChooseStarter;
    element("start-me").setAttribute("aria-pressed", String(iStart));
    element("start-friend").setAttribute("aria-pressed", String(!iStart));
    element("starter-summary").textContent = iStart ? "You press B. Your friend waits."
      : `${peer?.nickname ?? "Your friend"} presses B. You wait.`;
    const members = element("room-members");
    members.replaceChildren(...[me, peer].map((member, index) => {
      const row = document.createElement("li"); row.className = "member";
      const connected = !!online && !!member?.connected;
      const adapter = index === 0 ? this.adapter : member?.adapterConnected;
      row.dataset.connected = String(connected && !!adapter);
      const dot = document.createElement("span"); dot.className = "connection-dot"; dot.setAttribute("aria-hidden", "true");
      const text = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = member ? `${member.nickname}${index === 0 ? " (you)" : ""}` : index === 0 ? "You" : "Waiting for a friend…";
      const state = document.createElement("small");
      state.textContent = !member ? "Share the invite or room code" : !connected ? "Room disconnected"
        : adapter === null ? "In room · check adapter in their app" : adapter ? "In room · adapter connected" : "In room · connect adapter";
      text.append(name, state); row.append(dot, text); return row;
    }));
    this.showStartWindow = false;
    const heading = element("next-heading"), instruction = element("next-instruction");
    const prompt = element<HTMLButtonElement>("start-prompt");
    prompt.hidden = true;
    prompt.disabled = false;
    if (!inRoom) {
      heading.textContent = `A ${activityName}, wherever you are`;
      instruction.textContent = "Find someone in an open room, or create a room for a friend. Connect your adapter whenever you’re ready.";
    } else if (!online) {
      heading.textContent = "Reconnect to your room";
      instruction.textContent = "Keep your Paradise on its normal menu until you’re both connected here.";
    } else if (!peer?.connected) {
      heading.textContent = "Waiting for your friend";
      instruction.textContent = "Share the invite link or room code. Stay on your Paradise’s normal menu while you wait.";
    } else if (!this.adapter || peer.adapterConnected === false) {
      heading.textContent = "You’re both here";
      instruction.textContent = !this.adapter ? "Connect your UART adapter and attach it to your Paradise. Your friend’s connection appears above."
        : "Your adapter is connected. Waiting for your friend to connect theirs.";
    } else {
      heading.textContent = iStart ? "Press B once" : `Open ${activityName} and wait`;
      instruction.textContent = iStart
        ? `On both toys: Menu → Connection → ${activityName}. Once your friend is waiting on that screen, press B on your toy once.`
        : `On both toys: Menu → Connection → ${activityName}. Stay on that screen without pressing B; your friend presses B to start.`;
      if (peer.adapterConnected === null)
        instruction.textContent = "First, ask your friend to start the adapter bridge in their app. " + instruction.textContent;
      if (this.snapshot?.canChooseStarter) {
        const ready = this.snapshot.startPrompt === "ready" && performance.now() < this.readyUntil;
        const requested = !!this.snapshot.startPrompt;
        prompt.hidden = ready || (!iStart && !requested);
        prompt.textContent = iStart ? "Ask friend to get ready" : `I’m on ${activityName} screen`;
        prompt.disabled = iStart && this.snapshot.startPrompt === "prepare";
        if (this.snapshot.startPrompt === "started") {
          heading.textContent = "Follow your toy";
          instruction.textContent = "Toy data has started. Follow the steps on your Paradise.";
          prompt.hidden = true;
        } else if (this.snapshot.outcome === "interrupted") {
          heading.textContent = "The exchange stopped";
          instruction.textContent = iStart
            ? `Reopen ${activityName} on both toys. Your friend will confirm when ready.`
            : `Reopen Connection → ${activityName}, then confirm here. Don’t press B.`;
        } else if (ready) {
          this.showStartWindow = iStart;
          heading.textContent = iStart ? "Press B now" : "Wait—your friend is starting";
          instruction.textContent = iStart
            ? `Your friend is ready. On your Paradise, open Connection → ${activityName} and press B once now.`
            : `Stay on ${activityName} without pressing B. We’ve told your friend to press B on their toy.`;
        } else if (requested) {
          heading.textContent = iStart ? "Waiting for your friend’s ready" : `Go to Connection → ${activityName} and wait now`;
          instruction.textContent = iStart
            ? `Your friend needs to freshly open ${activityName} and confirm here. Then we’ll tell you to press B.`
            : `Don’t press B. Once you’re on that screen, click “I’m on ${activityName} screen.” Your friend will be told to press B. If you were already waiting there, reopen ${activityName} first.`;
        } else {
          heading.textContent = iStart ? "You’ll press B" : `You’ll wait on ${activityName}`;
          instruction.textContent = iStart
            ? "Ask your friend to get ready. Once they confirm, we’ll tell you to press B on your toy."
            : `Your friend will ask you to open ${activityName}. Stay on the normal menu until then.`;
        }
      }
    }
    if (this.client.activity === "gift") {
      if (this.snapshot?.startPrompt === "started") instruction.textContent = "Choose your items, review the exchange and confirm on your toys. Keep this page open until both toys finish.";
      if (this.snapshot?.outcome === "interrupted") instruction.textContent += " Check what each toy shows before trying again; the browser cannot tell whether an item was saved.";
    }
    this.updateStartWindow();
  }

  private updateStartWindow(): void {
    clearTimeout(this.readyTimer);
    const remaining = Math.max(0, this.readyUntil - performance.now());
    const ready = this.snapshot?.startPrompt === "ready" && remaining > 0 && this.socket?.readyState === WebSocket.OPEN;
    const visible = !!ready && this.showStartWindow;
    element("start-window").hidden = !visible;
    element("next-step").classList.toggle("start-now", visible);
    if (visible) {
      element<HTMLProgressElement>("start-window-progress").value = remaining;
      element("start-window-label").textContent = `${Math.ceil(remaining / 1000)}s to start`;
    }
    if (ready) this.readyTimer = setTimeout(() => {
      if (performance.now() >= this.readyUntil) this.render();
      else this.updateStartWindow();
    }, Math.min(200, remaining + 1));
  }
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing #${id}`);
  return result as T;
}
