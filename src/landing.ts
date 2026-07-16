import { createPhospheneScene } from "./phosphene-scene";
import { uiSound } from "./ui-sound";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const WORDMARK = "INNERFRA.ME";

// Substitute glyphs for the corruption flicker — one character at a time,
// briefly, like a signal mis-decoding. Letters without a substitute blank
// out instead, which reads as a dropout.
const GLYPH_SUBS: Record<string, string> = {
  I: "1",
  N: "И",
  E: "3",
  A: "4",
};

/**
 * The landing is a tuner: a monochrome haze field, the INNERFRA.ME wordmark,
 * and one interaction — scroll to tune in. Progress decays when you stop, so
 * entering takes a moment of commitment. Tuning reads as a descent: the
 * wordmark grows and rushes toward the viewer while the tagline falls away,
 * as though sinking toward the mark and about to pass through it. At full
 * lock the whole stage collapses like a CRT powering off (squash to a line,
 * to a point, gone) straight into the terminal boot. No ENTER button. About
 * lives in a click-open overlay. Resolves when the tune completes.
 */
export function showLanding(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const letters = WORDMARK.split("")
      .map((ch) =>
        ch === "."
          ? `<span class="wm-dot" aria-hidden="true">.</span>`
          : `<span class="wm-ch" data-ch="${ch}">${ch}</span>`,
      )
      .join("");

    const el = document.createElement("div");
    el.className = "landing landing--init";
    el.innerHTML = `
      <div class="landing-stage">
        <canvas class="landing-gl" aria-hidden="true"></canvas>
        <button class="about-link" data-role="about-open">About</button>
        <section class="landing-hero">
          <div class="tune-ring" aria-hidden="true"></div>
          <h1 class="wordmark" aria-label="INNERFRA.ME">${letters}</h1>
          <p class="hero-tagline">A music video shot on the inside of your eyelids.</p>
        </section>
        <div class="tune-cue" data-role="cue">
          <span class="tune-cue-label">${REDUCED_MOTION ? "" : "scroll to begin"}</span>
          <span class="tune-cue-rule" aria-hidden="true"><span class="tune-cue-fill" data-role="fill"></span></span>
        </div>
        ${REDUCED_MOTION ? '<button class="hero-enter landing-begin" data-role="begin">BEGIN</button>' : ""}
      </div>
      <div class="about-overlay" data-role="overlay" hidden>
        <button class="about-close" data-role="about-close">Close</button>
        <div class="about-inner">
          <p class="about-label">ABOUT</p>
          <div class="about-body">
            <p>INNERFRA.ME is a music video you can only watch with your eyes closed.</p>
            <p>A song is locked inside this page. Your camera watches for one thing: open or closed.</p>
            <p>Shut your eyes and the track begins. Look up and the signal drops. Close them again and it resumes from the exact moment you left.</p>
            <p>The screen gives you nothing. Your mind supplies the footage. Memory. Mood. Faces. Places. Whatever the song pulls up from the deep.</p>
            <p>We spend all day being shown what to see. INNERFRA.ME asks for three minutes in the dark and gives you the only cut nobody else can watch.</p>
            <p>Everything stays on your machine. The camera feed never leaves your browser. Nothing is recorded. Nothing is uploaded.</p>
            <p>When the track ends, you get a session report showing where you broke the spell and how long you stayed under, rendered as a card you can keep or share.</p>
            <p>You heard the same song as everyone else.</p>
            <p>You saw something entirely your own.</p>
          </div>
          <p class="about-credit">CONCEPT 2014 · BUILT 2026 · JASON NITTI</p>
        </div>
      </div>
    `;
    root.appendChild(el);

    document.documentElement.style.overflow = "hidden";
    uiSound.installUnlock();

    const canvas = el.querySelector(".landing-gl") as HTMLCanvasElement;
    const scene = createPhospheneScene(canvas);

    const stage = el.querySelector(".landing-stage") as HTMLElement;
    const hero = el.querySelector(".landing-hero") as HTMLElement;
    const wordmark = el.querySelector(".wordmark") as HTMLElement;
    const tagline = el.querySelector(".hero-tagline") as HTMLElement;
    const chars = Array.from(el.querySelectorAll<HTMLElement>(".wm-ch"));

    // All glyphs in visual order (letters + the dot), for a spread that's
    // symmetric around the middle of the mark — left half pushes left,
    // right half pushes right — rather than letter-spacing's one-sided
    // "everything shifts right of its predecessor."
    //
    // The per-step distance is computed from actual available viewport
    // width rather than a fixed em guess — a fixed constant either clipped
    // past the edge on narrow screens or was too timid on wide ones.
    const glyphs = Array.from(wordmark.children) as HTMLElement[];
    const glyphCenter = (glyphs.length - 1) / 2;
    let glyphOffsets = glyphs.map(() => 0);

    const recomputeGlyphOffsets = (): void => {
      const restWidth = wordmark.getBoundingClientRect().width;
      const fontSizePx = parseFloat(getComputedStyle(wordmark).fontSize) || 1;
      const margin = 20;
      const maxSpreadPx = Math.max(0, (window.innerWidth - restWidth) / 2 - margin);
      const maxSpreadEm = maxSpreadPx / fontSizePx;
      const perStepEm = glyphCenter > 0 ? maxSpreadEm / glyphCenter : 0;
      glyphOffsets = glyphs.map((_, i) => (i - glyphCenter) * perStepEm);
    };
    window.addEventListener("resize", recomputeGlyphOffsets);
    const ring = el.querySelector(".tune-ring") as HTMLElement;
    const cue = el.querySelector('[data-role="cue"]') as HTMLElement;
    const fill = el.querySelector('[data-role="fill"]') as HTMLElement;
    const overlay = el.querySelector('[data-role="overlay"]') as HTMLElement;

    let progress = 0;
    let complete = false;
    let overlayOpen = false;
    let lastInputAt = 0;
    let lastDetent = 0;
    let raf = 0;

    // Lock each letter to its natural width once fonts land, so a glyph
    // swapping to a blank or narrower substitute flickers in place instead
    // of reflowing the whole proportional-serif wordmark sideways.
    void document.fonts.ready.then(() => {
      for (const c of chars) {
        c.style.width = `${c.getBoundingClientRect().width.toFixed(2)}px`;
        c.style.textAlign = "center";
      }
      recomputeGlyphOffsets();
    });

    // --- corruption flicker: one glyph at a time, biased by cursor proximity ---
    // Getting close to the wordmark disturbs it more often — reuses this same
    // flicker mechanism rather than adding a separate hover-glitch effect, so
    // cursor interaction and ambient corruption never feel like two competing
    // systems.
    let pointerX = -9999;
    let pointerY = -9999;
    const onWordmarkPointer = (e: PointerEvent): void => {
      pointerX = e.clientX;
      pointerY = e.clientY;
    };
    window.addEventListener("pointermove", onWordmarkPointer, { passive: true });

    const proximity = (): number => {
      const rect = wordmark.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = pointerX - cx;
      const dy = pointerY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = Math.max(rect.width, rect.height) * 0.85;
      return Math.max(0, 1 - dist / radius);
    };

    const nearestCharToPointer = (): HTMLElement => {
      let best = chars[0];
      let bestDist = Infinity;
      for (const c of chars) {
        const r = c.getBoundingClientRect();
        const dx = pointerX - (r.left + r.width / 2);
        const dy = pointerY - (r.top + r.height / 2);
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      return best;
    };

    let corruptTimer = 0;
    const scheduleCorrupt = (): void => {
      const near = proximity();
      const idleMs = 3200 + Math.random() * 3400;
      const tunedMs = 260 + Math.random() * 380;
      const baseWait = idleMs + (tunedMs - idleMs) * progress;
      const wait = baseWait * (1 - near * 0.72);
      corruptTimer = window.setTimeout(() => {
        if (!complete && !overlayOpen && chars.length > 0) {
          const target =
            proximity() > 0.3
              ? nearestCharToPointer()
              : chars[Math.floor(Math.random() * chars.length)];
          const original = target.dataset.ch ?? "";
          target.textContent = GLYPH_SUBS[original] ?? " ";
          window.setTimeout(() => {
            target.textContent = original;
          }, 90 + Math.random() * 70);
        }
        scheduleCorrupt();
      }, wait);
    };

    // --- brief signal loss: whole mark displaces for ~100ms ---
    // dropOffset feeds into the same per-frame transform string as the zoom
    // (below), rather than toggling a class that would fight the inline
    // transform the frame loop sets every tick.
    let dropOffset = 0;
    let dropTimer = 0;
    const scheduleDrop = (): void => {
      dropTimer = window.setTimeout(() => {
        if (!complete && !overlayOpen) {
          wordmark.classList.add("wordmark--drop");
          dropOffset = 2;
          scene.pulse(0.6);
          window.setTimeout(() => {
            wordmark.classList.remove("wordmark--drop");
            dropOffset = 0;
          }, 110);
        }
        scheduleDrop();
      }, 8000 + Math.random() * 6000);
    };

    if (!REDUCED_MOTION) {
      scheduleCorrupt();
      scheduleDrop();
    }

    const finish = (): void => {
      window.clearTimeout(corruptTimer);
      window.clearTimeout(dropTimer);
      cancelAnimationFrame(raf);
      el.classList.add("landing--off");
      window.setTimeout(() => {
        scene.dispose();
        removeInputs();
        document.documentElement.style.overflow = "";
        el.remove();
        resolve();
      }, 200);
    };

    const lockIn = (): void => {
      if (complete) return;
      complete = true;
      uiSound.confirm();
      scene.setTune(1);
      scene.pulse(1);
      // The CRT-collapse animation on the stage does the heavy lifting
      // visually; finish() just needs to wait for it before cutting to
      // the terminal boot underneath.
      stage.classList.add("landing-stage--collapse");
      window.setTimeout(finish, REDUCED_MOTION ? 0 : 520);
    };

    const addProgress = (amount: number): void => {
      if (complete || overlayOpen) return;
      progress = Math.min(1, Math.max(0, progress + amount));
      lastInputAt = performance.now();
      const detent = Math.floor(progress * 14);
      if (detent !== lastDetent) {
        lastDetent = detent;
        if (detent > 0) uiSound.tick();
      }
      if (progress >= 1) lockIn();
    };

    // --- inputs: wheel, touch drag, keyboard ---
    const onWheel = (e: WheelEvent): void => addProgress(e.deltaY * 0.00038);

    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent): void => {
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY;
      if (touchY !== null && y !== undefined) {
        addProgress((touchY - y) * 0.0016);
        touchY = y;
      }
    };

    const onKey = (e: KeyboardEvent): void => {
      if (overlayOpen) {
        if (e.key === "Escape") closeOverlay();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        addProgress(0.12);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKey);

    const removeInputs = (): void => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onWordmarkPointer);
      window.removeEventListener("resize", recomputeGlyphOffsets);
    };

    // --- about overlay ---
    // The About link and the overlay's Close button share the same fixed
    // top-right position by design, so the link must vanish while the
    // overlay is up or the two labels render superimposed.
    const aboutLink = el.querySelector('[data-role="about-open"]') as HTMLElement;
    const aboutClose = el.querySelector('[data-role="about-close"]') as HTMLElement;
    const openOverlay = (): void => {
      overlayOpen = true;
      uiSound.click();
      overlay.hidden = false;
      aboutLink.style.visibility = "hidden";
      window.setTimeout(() => overlay.classList.add("about-overlay--open"), 20);
      aboutClose.focus();
    };
    const closeOverlay = (): void => {
      overlayOpen = false;
      uiSound.click();
      overlay.classList.remove("about-overlay--open");
      window.setTimeout(() => {
        overlay.hidden = true;
        aboutLink.style.visibility = "";
      }, 300);
      aboutLink.focus();
    };
    aboutLink.addEventListener("click", openOverlay);
    aboutClose.addEventListener("click", closeOverlay);

    el.querySelector('[data-role="begin"]')?.addEventListener("click", () => {
      progress = 1;
      lockIn();
    });

    // --- per-frame: decay, letter tracking, ring, cue, scene tune ---
    const frame = (): void => {
      const now = performance.now();

      if (!complete && progress > 0 && now - lastInputAt > 500) {
        progress = Math.max(0, progress - 0.0018);
      }

      scene.setTune(progress);

      // Tuning in: the mark holds its size, but each glyph pushes away from
      // the mark's own center — left half left, right half right — while
      // the ring (below) contracts inward. Two opposing motions instead of
      // one thing simply growing.
      for (let i = 0; i < glyphs.length; i++) {
        glyphs[i].style.transform = `translateX(${(glyphOffsets[i] * progress).toFixed(3)}em)`;
      }
      wordmark.style.transform = `translateX(${dropOffset}px)`;
      tagline.style.opacity = Math.max(0, 1 - progress * 1.6).toFixed(3);

      const ringScale = 1.15 - progress * 0.81;
      const ringOpacity = 0.1 + progress * 0.45;
      ring.style.transform = `translate(-50%, -50%) scale(${ringScale.toFixed(3)})`;
      ring.style.opacity = ringOpacity.toFixed(3);

      fill.style.transform = `scaleX(${progress.toFixed(3)})`;
      cue.style.opacity = progress > 0.88 ? "0" : "1";
      hero.style.setProperty("--tune", progress.toFixed(3));

      raf = requestAnimationFrame(frame);
    };

    // setTimeout rather than rAF: rAF can be throttled to seconds in
    // background/embedded contexts, which would hold the whole landing at
    // opacity 0 long after load.
    window.setTimeout(() => el.classList.remove("landing--init"), 40);
    if (!REDUCED_MOTION) {
      raf = requestAnimationFrame(frame);
    } else {
      ring.style.opacity = "0.14";
    }
  });
}
