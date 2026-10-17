import { nicknameProblem, normalizeNickname } from "@tama-breed-poc/tama-protocol";

/** Native form feedback shared by Playdate and game rooms. */
export function bindNickname(input: HTMLInputElement): void {
  input.addEventListener("input", () => {
    input.setCustomValidity(""); input.removeAttribute("aria-invalid");
  });
}

export function readNickname(input: HTMLInputElement): string {
  const name = normalizeNickname(input.value), problem = nicknameProblem(name);
  input.setCustomValidity(problem ?? "");
  if (problem) {
    input.setAttribute("aria-invalid", "true"); input.focus(); input.reportValidity();
    throw new Error(problem);
  }
  input.removeAttribute("aria-invalid"); input.value = name;
  return name;
}
