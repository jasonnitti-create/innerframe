import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import {
  phospheneVertexShader,
  phospheneFragmentShader,
  grainFragmentShader,
} from "./phosphene-shader";
import { uiSound } from "./ui-sound";
import { CymaticRing } from "./cymatic";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const WORDMARK = "INNERFRA.ME";

const EXCERPT =
  "The track dropped, and behind closed lids the innerframe rolled — no signal from outside, just cortex working the reel, splicing sound into sight the way the old net used to splice code into dream.";

// Substitute glyphs for the corruption flicker — one character at a time,
// briefly, like a signal mis-decoding. Letters without a substitute blank
// out instead, which reads as a dropout.
const GLYPH_SUBS: Record<string, string> = {
  I: "1",
  N: "И",
  E: "3",
  A: "4",
};

interface SceneHandle {
  dispose: () => void;
  setTune: (p: number) => void;
  pulse: (strength?: number) => void;
}

/**
 * The landing is a tuner: a monochrome haze field, the INNERFRA.ME wordmark,
 * and one interaction — scroll to tune in. Progress decays when you stop, so
 * entering takes a moment of commitment; at full lock the landing dissolves
 * straight into the experience. No ENTER button. About lives in a click-open
 * overlay. Resolves when the tune completes.
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
      <canvas class="landing-gl" aria-hidden="true"></canvas>
      <div class="cursor-glow" aria-hidden="true"></div>
      <div class="reveal-layer" aria-hidden="true">
        <span class="reveal-ring" style="left: 18%; top: 22%; width: 15vmin; height: 15vmin;"></span>
        <span class="reveal-ring" style="left: 80%; top: 70%; width: 11vmin; height: 11vmin;"></span>
        <span class="reveal-ring" style="left: 12%; top: 82%; width: 8vmin; height: 8vmin;"></span>
        <span class="reveal-tick" style="left: 8%; top: 10%;"></span>
        <span class="reveal-tick" style="left: 92%; top: 90%; transform: translate(-100%, -100%) rotate(180deg);"></span>
        <span class="reveal-frag" style="left: 15%; top: 58%;">1</span>
        <span class="reveal-frag" style="left: 72%; top: 18%;">И</span>
        <span class="reveal-frag" style="left: 62%; top: 84%;">3.4</span>
        <span class="reveal-frag" style="left: 32%; top: 12%;">//</span>
        <span class="reveal-frag" style="left: 86%; top: 45%;">4</span>
      </div>
      <button class="about-link" data-role="about-open">About</button>
      <section class="landing-hero">
        <h1 class="wordmark" aria-label="INNERFRA.ME">${letters}</h1>
        <p class="hero-tagline">A music video shot on the inside of your eyelids.</p>
      </section>
      <div class="tune-cue" data-role="cue">
        <span class="tune-cue-label">${REDUCED_MOTION ? "" : "scroll to begin"}</span>
        <span class="tune-cue-rule" aria-hidden="true"><span class="tune-cue-fill" data-role="fill"></span></span>
      </div>
      ${REDUCED_MOTION ? '<button class="hero-enter landing-begin" data-role="begin">BEGIN</button>' : ""}
      <div class="about-overlay" data-role="overlay" hidden>
        <button class="about-close" data-role="about-close">Close</button>
        <div class="about-inner">
          <p class="about-label">ABOUT</p>
          <p class="about-excerpt">&ldquo;${EXCERPT}&rdquo;</p>
          <div class="about-body">
            <p>INNERFRA.ME is a music video you can only watch with your eyes closed.</p>
            <p>A song is sealed inside this page. Your camera reads one thing — whether your eyes are open or shut — and the music plays only in the dark. Open your eyes and the signal cuts. Close them and it picks up exactly where you left it. The picture is yours to make, spliced from memory, mood, and whatever the track pulls up from the deep.</p>
            <p>We stare at screens all day and hold nothing for more than three seconds. This asks for three minutes, and it pays out the only footage nobody else can watch.</p>
            <p>Everything happens on your machine. The camera feed never leaves your browser; nothing is recorded, nothing is uploaded. When the song ends you get a session report — where you peeked, how long you stayed under — rendered as a card you can keep or share.</p>
          </div>
          <p class="about-credit">CONCEPT 2014 · BUILT 2026 · JASON NITTI</p>
        </div>
      </div>
    `;
    root.appendChild(el);

    document.documentElement.style.overflow = "hidden";
    uiSound.installUnlock();

    const canvas = el.querySelector(".landing-gl") as HTMLCanvasElement;
    const scene = startScene(canvas);

    const hero = el.querySelector(".landing-hero") as HTMLElement;
    const wordmark = el.querySelector(".wordmark") as HTMLElement;
    const chars = Array.from(el.querySelectorAll<HTMLElement>(".wm-ch"));
    const cymatic = new CymaticRing(hero);
    const cue = el.querySelector('[data-role="cue"]') as HTMLElement;
    const fill = el.querySelector('[data-role="fill"]') as HTMLElement;
    const overlay = el.querySelector('[data-role="overlay"]') as HTMLElement;

    let progress = 0;
    let complete = false;
    let overlayOpen = false;
    let lastInputAt = 0;
    let lastDetent = 0;
    let raf = 0;

    // --- cursor light: a weak, local flashlight with inertia ---
    // Radius starts at 0 (light "off") until the pointer actually moves, then
    // tracks with a lag and tightens on fast movement / expands once idle.
    let lightTX = window.innerWidth / 2;
    let lightTY = window.innerHeight / 2;
    let lightX = lightTX;
    let lightY = lightTY;
    let lightRadius = 0;
    let lightActive = false;
    let prevPX = lightTX;
    let prevPY = lightTY;
    let speedSmoothed = 0;
    let idleSince = performance.now();

    const onLightPointer = (e: PointerEvent): void => {
      lightTX = e.clientX;
      lightTY = e.clientY;
      lightActive = true;
    };
    window.addEventListener("pointermove", onLightPointer, { passive: true });

    // Lock each letter to its natural width once fonts land, so a glyph
    // swapping to a blank or narrower substitute flickers in place instead
    // of reflowing the whole proportional-serif wordmark sideways.
    void document.fonts.ready.then(() => {
      for (const c of chars) {
        c.style.width = `${c.getBoundingClientRect().width.toFixed(2)}px`;
        c.style.textAlign = "center";
      }
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
          target.textContent = GLYPH_SUBS[original] ?? " ";
          window.setTimeout(() => {
            target.textContent = original;
          }, 90 + Math.random() * 70);
        }
        scheduleCorrupt();
      }, wait);
    };

    // --- brief signal loss: whole mark displaces for ~100ms ---
    let dropTimer = 0;
    const scheduleDrop = (): void => {
      dropTimer = window.setTimeout(() => {
        if (!complete && !overlayOpen) {
          wordmark.classList.add("wordmark--drop");
          scene.pulse(0.6);
          window.setTimeout(() => wordmark.classList.remove("wordmark--drop"), 110);
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
        cymatic.dispose();
        removeInputs();
        window.removeEventListener("pointermove", onLightPointer);
        document.documentElement.style.overflow = "";
        el.remove();
        resolve();
      }, 650);
    };

    const lockIn = (): void => {
      if (complete) return;
      complete = true;
      uiSound.confirm();
      scene.setTune(1);
      scene.pulse(1);
      el.classList.add("landing--locked");
      window.setTimeout(finish, 380);
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

    // --- per-frame: decay, letter drift, cymatic figure, cursor light, cue ---
    const phases = chars.map(() => Math.random() * Math.PI * 2);
    const frame = (): void => {
      const now = performance.now();

      if (!complete && progress > 0 && now - lastInputAt > 500) {
        progress = Math.max(0, progress - 0.0018);
      }

      scene.setTune(progress);

      const t = now / 1000;
      const amp = 0.4 + progress * 3.4;
      for (let i = 0; i < chars.length; i++) {
        const x = Math.sin(t * 1.7 + phases[i]) * amp * 0.4;
        const y = Math.cos(t * 1.3 + phases[i] * 1.7) * amp;
        chars[i].style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      }

      cymatic.draw(progress, t);

      // cursor light: lag toward the pointer, tighten on fast movement,
      // expand slightly once the pointer has been still for a moment
      const dx = lightTX - prevPX;
      const dy = lightTY - prevPY;
      const instSpeed = Math.sqrt(dx * dx + dy * dy);
      prevPX = lightTX;
      prevPY = lightTY;
      speedSmoothed += (instSpeed - speedSmoothed) * 0.2;
      if (instSpeed > 0.4) idleSince = now;
      const idleBoost = Math.min(1, (now - idleSince) / 900) * 36;

      lightX += (lightTX - lightX) * 0.09;
      lightY += (lightTY - lightY) * 0.09;
      const targetRadius = lightActive
        ? Math.min(250, Math.max(85, 185 - speedSmoothed * 2.2 + idleBoost))
        : 0;
      lightRadius += (targetRadius - lightRadius) * 0.08;

      el.style.setProperty("--lx", `${lightX.toFixed(1)}px`);
      el.style.setProperty("--ly", `${lightY.toFixed(1)}px`);
      el.style.setProperty("--lr", `${Math.max(0, lightRadius).toFixed(1)}px`);

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
      cymatic.draw(0.12, 0);
    }
  });
}

function startScene(canvas: HTMLCanvasElement): SceneHandle {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  } catch {
    canvas.remove();
    return { dispose: () => {}, setTune: () => {}, pulse: () => {} };
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const bg = new THREE.Color(0x070707);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth * dpr, window.innerHeight * dpr) },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uMouseEnergy: { value: 0 },
    uTune: { value: 0 },
    uBg: { value: new THREE.Vector3(bg.r, bg.g, bg.b) },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: phospheneVertexShader,
    fragmentShader: phospheneFragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5,
    0.5,
    0.5,
  );
  composer.addPass(bloom);

  const grainPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth * dpr, window.innerHeight * dpr) },
      uAmount: { value: 0.085 },
    },
    vertexShader: phospheneVertexShader,
    fragmentShader: grainFragmentShader,
  });
  grainPass.renderToScreen = true;
  composer.addPass(grainPass);

  const mouseTarget = new THREE.Vector2(0.5, 0.5);
  const mousePos = new THREE.Vector2(0.5, 0.5);
  let mouseEnergy = 0;
  let lastMoveAt = performance.now();
  let tuneTarget = 0;
  let tune = 0;
  let pulseLevel = 0;

  const onPointerMove = (e: PointerEvent): void => {
    const nx = e.clientX / window.innerWidth;
    const ny = 1 - e.clientY / window.innerHeight;
    const dx = nx - mouseTarget.x;
    const dy = ny - mouseTarget.y;
    mouseEnergy = Math.min(0.5, mouseEnergy + Math.sqrt(dx * dx + dy * dy) * 2.5);
    mouseTarget.set(nx, ny);
    lastMoveAt = performance.now();
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });

  const onResize = (): void => {
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloom.setSize(window.innerWidth, window.innerHeight);
    uniforms.uResolution.value.set(window.innerWidth * dpr, window.innerHeight * dpr);
    grainPass.uniforms.uResolution.value.set(window.innerWidth * dpr, window.innerHeight * dpr);
  };
  window.addEventListener("resize", onResize);

  let raf = 0;
  const start = performance.now();

  const frame = (): void => {
    const now = performance.now();
    const t = (now - start) / 1000;

    mousePos.lerp(mouseTarget, 0.07);
    if (now - lastMoveAt > 60) mouseEnergy *= 0.94;
    tune += (tuneTarget - tune) * 0.08;
    pulseLevel *= 0.9;

    uniforms.uTime.value = t;
    uniforms.uMouse.value.copy(mousePos);
    uniforms.uMouseEnergy.value = mouseEnergy;
    uniforms.uTune.value = tune;
    grainPass.uniforms.uTime.value = t;
    grainPass.uniforms.uAmount.value = 0.085 + tune * 0.09 + pulseLevel * 0.18;

    composer.render();
    raf = requestAnimationFrame(frame);
  };

  if (REDUCED_MOTION) {
    composer.render();
  } else {
    raf = requestAnimationFrame(frame);
  }

  return {
    dispose: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      quad.geometry.dispose();
      material.dispose();
      composer.dispose();
      renderer.dispose();
    },
    setTune: (p: number) => {
      tuneTarget = p;
    },
    pulse: (strength = 1) => {
      pulseLevel = Math.max(pulseLevel, strength);
    },
  };
}
