import { readConfig } from "./config";
import { buildServer } from "./server";

const config = readConfig();
const app = await buildServer(config);

await app.listen({ port: config.port, host: "0.0.0.0" });
