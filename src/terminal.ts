import { uiSound } from "./ui-sound";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Terminal {
  private log: HTMLElement;
  private statusEl: HTMLElement;

  constructor(private root: HTMLElement) {
    this.root.innerHTML = `
      <div class="terminal-log" data-role="log"></div>
      <div class="terminal-status" data-role="status"></div>
    `;
    this.log = this.root.querySelector('[data-role="log"]') as HTMLElement;
    this.statusEl = this.root.querySelector('[data-role="status"]') as HTMLElement;
  }

  async type(text: string, className = "line", speedMs = 20): Promise<void> {
    const p = document.createElement("p");
    p.className = className;
    this.log.appendChild(p);

    if (REDUCED_MOTION) {
      p.textContent = text;
      this.scrollToEnd();
      return;
    }

    p.classList.add("cursor");
    for (const ch of text) {
      p.textContent += ch;
      this.scrollToEnd();
      await sleep(speedMs);
    }
    p.classList.remove("cursor");
  }

  line(text: string, className = "line"): HTMLParagraphElement {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    this.log.appendChild(p);
    this.scrollToEnd();
    return p;
  }

  clear(): void {
    this.log.innerHTML = "";
    this.log.classList.remove("terminal-log--wide");
  }

  widen(): void {
    this.log.classList.add("terminal-log--wide");
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  mount(el: HTMLElement): void {
    this.log.appendChild(el);
    this.scrollToEnd();
  }

  async button(label: string): Promise<void> {
    return new Promise((resolve) => {
      const btn = document.createElement("button");
      btn.className = "term-btn";
      btn.textContent = label;
      btn.addEventListener(
        "click",
        () => {
          uiSound.click();
          btn.remove();
          resolve();
        },
        { once: true },
      );
      this.log.appendChild(btn);
      this.scrollToEnd();
    });
  }

  private scrollToEnd(): void {
    this.root.scrollTop = this.root.scrollHeight;
  }
}
