import { readConfig } from "./config";
import { buildServer } from "./server";

const config = readConfig();
const app = await buildServer(config);

// Bind to loopback only — nginx proxies us on the same host. UFW already
// blocks external access, this is belt + suspenders.
await app.listen({ port: config.port, host: "127.0.0.1" });
