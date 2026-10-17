import { defineConfig } from "vitest/config";

// Keep this workspace independent of a parent checkout's Vite configuration.
export default defineConfig({ test: { environment: "node" } });
