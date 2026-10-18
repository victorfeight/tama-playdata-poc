import "./ui/styles.css";
import { MSG_FLAG_SET_SESSION_ID, TcpObserver, parseGiftPayload } from "@tama-breed-poc/tama-protocol";
import { mountStockShell } from "./ui/stock-shell";
import { mountStockLink, must } from "./stock-link";
import { Drawer } from "./ui/drawer";
import { ExchangeScreen } from "./ui/screen-exchange";
import { Scene } from "./gift/scene";
import { getItemCatalogEntry } from "./gift/item-catalog";

mountStockShell("gift");
const canvas = must<HTMLCanvasElement>("link-canvas");
// The soft Gift artwork meets the shell's rounded edge without an overlaid frame.
const scene = new Scene(new Drawer(canvas, canvas.getContext("2d")!, "/sprites/tama_trade.png?v=f31529fd18fd", false));
scene.mount();
const exchange = new ExchangeScreen(must("byte-log"), must("ghost-summary"));
const offers = new Map<string, number>();
const make = (side: "local" | "peer") => new TcpObserver({
  packet(packet) {
    if (packet.msgType !== 2 || (packet.rawMsgType & MSG_FLAG_SET_SESSION_ID)) return;
    try {
      const gift = parseGiftPayload(packet.payload);
      if (gift.phase === "version") {
        exchange.pushSystem(`${side}: Gift version ${gift.version} observed.`);
        scene.setStatus("choose items on your toys");
      } else {
        offers.set(side, gift.itemId!);
        scene.setItem(side, gift.itemId!);
        scene.setStatus("review on your toys");
        exchange.showMessage([...offers].map(([who, id]) => `${who === "local" ? "Your offer" : "Their offer"}: ${getItemCatalogEntry(id)?.name ?? `Item ${id}`}`).join(" · "));
        exchange.pushSystem(`${side}: item ${gift.itemId} observed; not proof of saving.`);
      }
    } catch { exchange.pushSystem(`${side}: unrecognized Gift packet (${packet.payload.length} bytes).`); }
  },
  command(line) { exchange.pushSystem(`${side}: ${line}`); },
  resync(reason, total) { exchange.pushSystem(`${side}: preview resync #${total}: ${reason}. Forwarded bytes unchanged.`); }
});
const out = make("local"), incoming = make("peer");
// Separate existing Gift service/database. A build on the Playdate origin must
// not silently send Gift users to Playdate rooms.
const relayUrl = import.meta.env.VITE_GIFT_RELAY_URL ?? (import.meta.env.DEV ? "http://localhost:3002" : "https://trade.bbamorachi.us");
mountStockLink("gift", relayUrl, scene, exchange, out, incoming, () => {
  offers.clear(); out.reset(); incoming.reset(); exchange.reset(); scene.beginSession();
});
