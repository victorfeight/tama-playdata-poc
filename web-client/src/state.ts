export type AppState = "IDLE" | "SERIAL_OPEN" | "WS_OPEN" | "PAIRED" | "EXCHANGING" | "DONE" | "ERROR";

export class StateMachine {
  private state: AppState = "IDLE";
  private listeners = new Set<(state: AppState) => void>();

  get current(): AppState {
    return this.state;
  }

  set(next: AppState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  onChange(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
}
