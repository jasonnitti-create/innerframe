import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { phospheneVertexShader, phospheneFragmentShader, grainFragmentShader } from "./phosphene-shader";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface PhospheneSceneHandle {
  dispose: () => void;
  setTune: (p: number) => void;
  pulse: (strength?: number) => void;
}

/**
 * The monochrome haze field — shared between the landing (where scroll
 * "tunes" it down as you commit) and the eyes-closed void in the terminal
 * experience (where it just runs at full intensity and CSS opacity handles
 * appearing/disappearing). One scene per canvas; each caller owns disposal.
 */
export function createPhospheneScene(canvas: HTMLCanvasElement): PhospheneSceneHandle {
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
