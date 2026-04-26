export interface AppConfig {
  relayUrl: string;
}

export const config: AppConfig = {
  relayUrl: import.meta.env.VITE_RELAY_URL ?? "http://localhost:3001"
};
