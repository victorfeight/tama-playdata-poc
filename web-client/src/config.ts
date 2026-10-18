export interface AppConfig {
  relayUrl: string;
}

export const config: AppConfig = {
  relayUrl: import.meta.env.VITE_RELAY_URL ?? (import.meta.env.DEV ? "http://localhost:3001" : location.origin)
};
