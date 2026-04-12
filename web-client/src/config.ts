export interface AppConfig {
  relayUrl: string;
  relaySecret: string;
}

export const config: AppConfig = {
  relayUrl: import.meta.env.VITE_RELAY_URL ?? "http://localhost:3001",
  relaySecret: import.meta.env.VITE_RELAY_SECRET ?? "dev-only"
};
