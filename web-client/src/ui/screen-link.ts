import { StateMachine } from "../state";

export class LinkScreen {
  constructor(private readonly state: StateMachine) {}

  bindState(element: HTMLElement): void {
    this.state.onChange((value) => {
      element.textContent = value.toLowerCase();
    });
  }
}
