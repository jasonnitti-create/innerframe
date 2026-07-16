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

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const EXCERPT =
  "The track dropped, and behind closed lids the innerframe rolled — no signal from outside, just cortex working the reel, splicing sound into sight the way the old net used to splice code into dream.";

/**
 * Full-bleed landing: a shader-driven phosphene field + hero type + about
 * section. Resolves when the user clicks ENTER. Cleans up all GL resources
 * and listeners before resolving so the experience starts on a quiet page.
 */
export function showLanding(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "landing landing--init";
    el.innerHTML = `
      <canvas class="landing-gl" aria-hidden="true"></canvas>
      <div class="landing-corner">scroll</div>
      <section class="landing-hero">
        <h1 class="hero-logo">INNERFRAME</h1>
        <p class="hero-tagline">A music video shot on the inside of your eyelids.</p>
        <button class="hero-enter" data-role="enter">ENTER</button>
      </section>
      <section class="landing-about">
        <p class="about-label">ABOUT</p>
        <p class="about-excerpt">&ldquo;${EXCERPT}&rdquo;</p>
        <div class="about-body">
          <p>INNERFRAME is a music video you can only watch with your eyes closed.</p>
          <p>A song is sealed inside this page. Your camera reads one thing — whether your eyes are open or shut — and the music plays only in the dark. Open your eyes and the signal cuts. Close them and it picks up exactly where you left it. The picture is yours to make, spliced from memory, mood, and whatever the track pulls up from the deep.</p>
          <p>We stare at screens all day and hold nothing for more than three seconds. This asks for three minutes, and it pays out the only footage nobody else can watch.</p>
          <p>Everything happens on your machine. The camera feed never leaves your browser; nothing is recorded, nothing is uploaded. When the song ends you get a session report — where you peeked, how long you stayed under — rendered as a card you can keep or share.</p>
        </div>
        <button class="hero-enter" data-role="enter">ENTER</button>
        <p class="about-credit">CONCEPT 2014 · BUILT 2026 · JASON NITTI</p>
      </section>
    `;
    root.appendChild(el);

    const canvas = el.querySelector(".landing-gl") as HTMLCanvasElement;
    const disposeGL = startScene(canvas);

    requestAnimationFrame(() => el.classList.remove("landing--init"));

    // Corner chrome belongs to the hero threshold — it recedes once the
    // reader has scrolled into About, so it doesn't collide with that
    // section's own label/credit lines sitting at the same viewport edges.
    const corners = el.querySelectorAll<HTMLElement>(".landing-corner");
    const onCornerScroll = (): void => {
      const fade = 1 - Math.min(1, window.scrollY / 220);
      corners.forEach((c) => {
        c.style.opacity = String(fade);
      });
    };
    window.addEventListener("scroll", onCornerScroll, { passive: true });

    const finish = (): void => {
      el.classList.add("landing--off");
      window.setTimeout(() => {
        disposeGL();
        window.removeEventListener("scroll", onCornerScroll);
        el.remove();
        window.scrollTo(0, 0);
        resolve();
      }, 650);
    };

    el.querySelectorAll('[data-role="enter"]').forEach((btn) => {
      btn.addEventListener("click", finish, { once: true });
    });
  });
}

function startScene(canvas: HTMLCanvasElement): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  } catch {
    canvas.remove();
    return () => {};
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const accentHex = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#39ff6a";
  const accent = new THREE.Color(accentHex);
  const bg = new THREE.Color(0x0b0a08);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth * dpr, window.innerHeight * dpr) },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uMouseEnergy: { value: 0 },
    uScroll: { value: 0 },
    uAccent: { value: new THREE.Vector3(accent.r, accent.g, accent.b) },
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
    0.75, // strength
    0.55, // radius
    0.55, // threshold — only genuine highlights bloom, not midtones
  );
  composer.addPass(bloom);

  const grainPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth * dpr, window.innerHeight * dpr) },
    },
    vertexShader: phospheneVertexShader,
    fragmentShader: grainFragmentShader,
  });
  grainPass.renderToScreen = true;
  composer.addPass(grainPass);

  // Mouse position smoothed toward its target for an organic lag, and an
  // "energy" scalar that spikes on fast movement then decays — the phosphor-
  // persistence feel of having just brushed past something in the dark.
  const mouseTarget = new THREE.Vector2(0.5, 0.5);
  const mousePos = new THREE.Vector2(0.5, 0.5);
  let mouseEnergy = 0;
  let lastMoveAt = performance.now();

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
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloom.setSize(window.innerWidth, window.innerHeight);
    uniforms.uResolution.value.set(window.innerWidth * dpr, window.innerHeight * dpr);
    grainPass.uniforms.uResolution.value.set(window.innerWidth * dpr, window.innerHeight * dpr);
  };
  window.addEventListener("resize", onResize);

  const onScroll = (): void => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    uniforms.uScroll.value = max > 0 ? Math.min(1, window.scrollY / max) : 0;
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  let raf = 0;
  const start = performance.now();

  const frame = (): void => {
    const now = performance.now();
    const t = (now - start) / 1000;

    mousePos.lerp(mouseTarget, 0.07);
    if (now - lastMoveAt > 60) {
      mouseEnergy *= 0.94;
    }

    uniforms.uTime.value = t;
    uniforms.uMouse.value.copy(mousePos);
    uniforms.uMouseEnergy.value = mouseEnergy;
    grainPass.uniforms.uTime.value = t;

    composer.render();
    raf = requestAnimationFrame(frame);
  };

  if (REDUCED_MOTION) {
    composer.render();
  } else {
    raf = requestAnimationFrame(frame);
  }

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll);
    quad.geometry.dispose();
    material.dispose();
    composer.dispose();
    renderer.dispose();
  };
}
