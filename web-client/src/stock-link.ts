import type { StockActivity } from "@tama-breed-poc/tama-protocol";
import { WebSerialTransport, WebUsbSerialPort, TcpObserver } from "@tama-breed-poc/tama-protocol";
import { LobbyClient } from "./lobby-client";
import { StockLobby } from "./ui/stock-lobby";
import { SerialBridge } from "./serial-bridge";
import { ExchangeScreen } from "./ui/screen-exchange";
import { connectDongle, hasParadiseSerial } from "./utils/webserial";

export function mountStockLink(activity: StockActivity, relayUrl: string,
  scene: { setStatus(text: string): void }, exchange: ExchangeScreen,
  outObserver: TcpObserver, inObserver: TcpObserver, resetPreview: () => void): void {
  let serial: WebSerialTransport | undefined;
  let bridge: SerialBridge | undefined;
  let socket: WebSocket | undefined;
  let serialOpenPending = false;
  function beginSession(): void { lastByteAt = 0; resetPreview(); }
  must("save-log").addEventListener("click", () => {
    const summary = ["Paradise Link connection log", `Saved: ${new Date().toISOString()}`,
      `Page: ${location.origin}${location.pathname}`, `App: ${import.meta.url}`,
      `Browser: ${navigator.userAgent}`, `Room: ${lobby.roomCode ?? "none"}`,
      `Role: ${lobby.role ?? "unknown"}`, `Adapter: ${serial?.info.label ?? "disconnected"}`,
      `Bytes in: ${bytesInEl.textContent}; out: ${bytesOutEl.textContent}`, "", exchange.diagnosticLog()];
    const url = URL.createObjectURL(new Blob([summary.join("\n") + "\n"], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${activity}-${lobby.roomCode ?? "offline"}-${Date.now()}.txt`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const portEl = must("port");
  const roomEl = must("room");
  const roleEl = must("role");
  const activityEl = must("activity");
  const bytesInEl = must("bytes-in");
  const bytesOutEl = must("bytes-out");

  // Last serial-bridge byte timestamp, used to derive Activity = live | idle.
  // "live" = a byte was seen within ACTIVITY_LIVE_MS, "idle" = paired but quiet.
  let lastByteAt = 0;
  const ACTIVITY_LIVE_MS = 2000;
  const lobby = new StockLobby(new LobbyClient(relayUrl, activity), {
    socket(next) {
      exchange.pushSystem(next ? "Room socket connected; attaching serial bridge if adapter is open." : "Room socket detached.");
      bridge?.stop();
      bridge = undefined;
      socket = next;
      beginSession();
      bytesInEl.textContent = "0";
      bytesOutEl.textContent = "0";
      if (next) void attachBridge();
      // Defer the HUD until the constructor has finished assigning lobby.
      queueMicrotask(renderHud);
    },
    peerChanged() { exchange.pushSystem("Peer membership/adapter status changed; resetting preview only."); beginSession(); }
  });

  // USB unplug funnels into the same recovery path as a manual click.
  navigator.serial?.addEventListener("disconnect", (event) => {
    if (serial && (event.target as unknown) === (serial.port as unknown)) {
      void releaseSerial();
    }
  });
  navigator.usb?.addEventListener("disconnect", (event) => {
    if (serial?.port instanceof WebUsbSerialPort && event.device === serial.port.usbDevice) {
      void releaseSerial();
    }
  });

  must<HTMLButtonElement>("connect-serial").addEventListener("click", async () => {
    if (serialOpenPending) return;
    if (serial) { await releaseSerial(); return; }

    try {
      if (!hasParadiseSerial()) throw new Error("WebSerial and WebUSB unavailable");
      serialOpenPending = true;
      renderHud();
      showAppMessage("Choose your Paradise dongle.");
      serial = await connectDongle();
      exchange.pushSystem(`Adapter opened: ${serial.info.label}; stock UART settings.`);
      showAppMessage("Dongle connected.");
      renderHud();
      await attachBridge();
    } catch (error) {
      showAppError(error);
    } finally {
      serialOpenPending = false;
      renderHud();
    }
  });

  async function attachBridge(): Promise<void> {
    if (!serial || !socket || socket.readyState !== WebSocket.OPEN) return;
    if (bridge && !bridge.isClosed) return;
    bridge?.stop();
    bridge = undefined;
    beginSession();
    bridge = new SerialBridge(serial, socket, {
      bytes(direction, data, stats) {
        exchange.pushBytes(direction, data);
        const observer = direction === "out" ? outObserver : inObserver;
        observer.push(data);
        bytesInEl.textContent = String(stats.bytesIn);
        bytesOutEl.textContent = String(stats.bytesOut);
        lastByteAt = performance.now();
      },
      error(error) {
        // Release a failed port while retaining room membership for recovery.
        void releaseSerial();
        showAppError(error);
      }
    });
    bridge.start();
    exchange.pushSystem(`Serial bridge attached to room ${lobby.roomCode ?? "unknown"}.`);
    showAppMessage("Adapter connected. Follow the steps beside the scene.");
  }

  async function releaseSerial(): Promise<void> {
    if (!serial) return;
    serialOpenPending = true;
    const dyingSerial = serial;
    bridge?.stop();
    bridge = undefined;
    serial = undefined;
    exchange.pushSystem("Adapter released; bridge stopped.");
    beginSession();
    showAppMessage("Adapter disconnected. You can reconnect without leaving your room.");
    renderHud();
    try { await dyingSerial.close(); }
    catch { /* Unplug may already have closed the stream. */ }
    finally { serialOpenPending = false; renderHud(); }
  }

  /**
   * Single source of truth for the connection HUD. Reads the (serial, socket,
   * role) triple and writes Dongle / Room / Role together. Called from every
   * state-mutating handler so the HUD never lies.
   */
  function renderHud(): void {
    portEl.textContent = serial ? `connected · ${serial.info.label}` : "disconnected";
    const isRoomLive = socket?.readyState === WebSocket.OPEN;
    roomEl.textContent = lobby.roomCode ?? "none";
    roleEl.textContent = isRoomLive ? lobby.role ?? "—" : "—";
    const connect = must<HTMLButtonElement>("connect-serial");
    connect.textContent = serialOpenPending ? "Connecting…" : serial ? "Disconnect" : "Connect adapter";
    connect.disabled = serialOpenPending;
    must("adapter-status").textContent = serial ? "Adapter connected" : "Adapter disconnected";
    must("adapter-status").dataset.connected = String(!!serial);
    lobby.setAdapter(!!serial);
    const paired = !!serial && isRoomLive;
    if (!paired) activityEl.textContent = "—";
    else activityEl.textContent = (performance.now() - lastByteAt) < ACTIVITY_LIVE_MS ? "live" : "idle";
  }

  renderHud();
  // Activity flips back to "idle" after silence — needs a low-rate tick because
  // the event-driven renderHud calls only fire on state changes, not on the
  // passage of time. 1Hz is well below any noticeable cost (one DOM textContent
  // per second, ~microseconds of CPU, no GC pressure).
  setInterval(renderHud, 1000);

  function showAppMessage(message: string): void {
    must("connection-message").hidden = true;
    exchange.showMessage(message);
    scene.setStatus(shortStatus(message));
  }

  function showAppError(error: unknown): void {
    const message = friendlyError(error);
    exchange.pushSystem(`Error: ${message}`);
    must("connection-message").textContent = message;
    must("connection-message").hidden = false;
    exchange.showMessage(message);
    scene.setStatus(shortStatus(message));
  }

  function shortStatus(message: string): string {
    if (/Adapter connected/i.test(message)) return "adapter connected";
    if (/Adapter disconnected/i.test(message)) return "adapter disconnected";
    if (/choose/i.test(message)) return "choose dongle";
    if (/dongle connected/i.test(message)) return "dongle connected";
    if (/room open/i.test(message)) return "room open";
    if (/exchange live/i.test(message)) return "exchange live";
    if (/already open/i.test(message)) return "dongle already open";
    if (/could not open/i.test(message)) return "dongle busy";
    if (/relay/i.test(message) && /room|create/i.test(message)) return "relay unavailable";
    return message.length > 42 ? `${message.slice(0, 39)}...` : message;
  }

  function friendlyError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/no port selected/i.test(message)) return "No dongle selected.";
    if (/port is already open/i.test(message)) return "That dongle is already open in this tab.";
    if (/failed to open serial port/i.test(message)) return "Could not open the dongle. Close other tabs/apps using it, then try again.";
    if (/WebSerial and WebUSB unavailable/i.test(message)) return "Use a browser with WebSerial or WebUSB over HTTPS to connect the dongle.";
    if (/create room failed/i.test(message)) return "Could not create a room. Check that the relay server is running.";
    return message;
  }

}

export function must<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

