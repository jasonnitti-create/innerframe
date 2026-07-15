import "./styles.css";
import { Terminal } from "./terminal";
import { FaceTracker, type EyeState } from "./face-tracker";
import { AudioEngine } from "./audio-engine";
import { renderReportCard, exportPNG, type SessionData } from "./report-card";

interface Track {
  title: string;
  artist: string;
  year: string;
  audioSrc: string;
  accent: string;
}

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sessionSerial(): string {
  const n = Math.floor(Math.random() * 9999) + 1;
  return `SESSION №${String(n).padStart(4, "0")}`;
}

async function main(): Promise<void> {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="stage">
      <div class="terminal" data-role="terminal"></div>
      <div class="void" data-role="void"></div>
      <div class="face-monitor" data-role="monitor" hidden>
        <video data-role="video" playsinline muted></video>
      </div>
    </div>
  `;

  const term = new Terminal(app.querySelector('[data-role="terminal"]') as HTMLElement);
  const voidEl = app.querySelector('[data-role="void"]') as HTMLElement;
  const monitorEl = app.querySelector('[data-role="monitor"]') as HTMLElement;
  const video = app.querySelector('[data-role="video"]') as HTMLVideoElement;

  const track: Track = await fetch(`${import.meta.env.BASE_URL}track.json`).then((r) =>
    r.json(),
  );

  document.documentElement.style.setProperty("--accent", track.accent);

  const audio = new AudioEngine(`${import.meta.env.BASE_URL}${track.audioSrc.replace(/^\.\//, "")}`);
  const tracker = new FaceTracker(video);
  const serial = sessionSerial();

  let eyesOpenedCount = 0;
  const peeks: number[] = [];
  let sessionStartedAt = 0;

  // --- BOOT ---
  term.setStatus(serial);
  await term.type("Hello there.");
  await sleep(300);
  await term.type("I've hidden a piece of music inside this page.");
  await sleep(200);
  await term.type("There's only one way to hear it. You have to close your eyes.", "line accent");
  await sleep(200);
  await term.type("Everything you're about to do stays on this machine. No video is recorded. No video is sent anywhere.", "line dim");
  await sleep(300);
  await term.button("Continue");
  term.clear();

  // --- PRIME ---
  await term.type("I need your camera to know when your eyes are closed.");
  await term.type("The feed never leaves your browser — I'm only reading whether your eyes are open or shut, frame by frame, and then forgetting.", "line dim");
  await term.button("Allow camera");

  term.setStatus("requesting camera…");
  let cameraGranted = false;
  try {
    await tracker.requestCamera();
    cameraGranted = true;
  } catch {
    cameraGranted = false;
  }

  if (!cameraGranted) {
    term.setStatus("honor system");
    term.clear();
    await term.type("No camera. Fine.");
    await term.type("We'll run this on the honor system. Close your eyes when the music starts — I'm trusting you.", "line dim");
    await term.button("Play");
    await runHonorMode();
    return;
  }

  monitorEl.hidden = false;
  term.clear();
  term.setStatus("loading model…");
  await term.type("Loading…");

  try {
    await tracker.init();
  } catch {
    tracker.stopCamera();
    monitorEl.hidden = true;
    term.setStatus("honor system");
    await term.type("Couldn't load the tracker. Let's run this on the honor system instead.", "line dim");
    await term.button("Play");
    await runHonorMode();
    return;
  }

  // --- CALIBRATE ---
  term.clear();
  term.setStatus("calibrating…");
  await term.type("Finding your face…");

  const faceOk = await waitForFace();
  if (!faceOk) {
    const brightness = tracker.sampleBrightness();
    term.clear();
    if (brightness < 0.14) {
      await term.type("Too dark in here to see you. Ironic.", "line accent");
      await term.type("Find some light and try again.", "line dim");
    } else {
      await term.type("Can't find your face. Center yourself in frame and try again.", "line dim");
    }
    await term.button("Retry");
    location.reload();
    return;
  }

  const openBaseline = await tracker.sampleClosedness(1200);

  await term.type("Try closing your eyes for three seconds.");
  const closedBaseline = await tracker.sampleClosedness(3000, (f) =>
    term.setStatus(`calibrating… ${Math.round(f * 100)}%`),
  );

  const spread = Math.max(closedBaseline - openBaseline, 0.15);
  const closedThreshold = Math.min(0.85, Math.max(0.3, openBaseline + spread * 0.5));
  const openThreshold = Math.max(0.05, closedThreshold - 0.14);
  tracker.setThresholds(closedThreshold, openThreshold);

  await term.type("Good. Now try six seconds — this time for real.");
  const rehearsed = await rehearseClosedEyes(6000);
  if (!rehearsed) {
    await term.type("We lost you partway through. No matter — you'll get another shot once the song starts.", "line dim");
  } else {
    await term.type("Good.");
  }

  // --- ARMED ---
  term.clear();
  term.setStatus("ready");
  await term.type("Are you ready to watch?");
  await term.button("YES");

  audio.unlock();
  await term.type("Close your eyes to begin.");

  await new Promise<void>((resolve) => {
    tracker.start(
      (state) => {
        if (state.closed) {
          tracker.stop();
          resolve();
        }
      },
      () => {},
    );
  });

  // --- PLAYING / INTERRUPTED loop ---
  monitorEl.style.opacity = "0.25";
  sessionStartedAt = performance.now();
  await audio.start();
  enterDark();

  let ended = false;
  audio.onEnded(() => {
    ended = true;
  });

  let interrupted = false;

  tracker.start(
    (state: EyeState) => {
      if (ended) return;

      if (!interrupted && state.faceDetected && !state.closed) {
        interrupted = true;
        eyesOpenedCount += 1;
        peeks.push(audio.currentTime);
        audio.pauseSoft();
        exitDark();
        term.clear();
        term.setStatus(`eyes opened: ${eyesOpenedCount}`);
        term.line("Eyes opened. Signal lost.", "line accent");
        term.line("Close your eyes to continue.", "line dim");
      } else if (interrupted && state.faceDetected && state.closed) {
        interrupted = false;
        term.clear();
        audio.resumeSoft();
        enterDark();
      }
    },
    () => {
      if (ended || interrupted) return;
      audio.pauseSoft();
      exitDark();
      term.clear();
      term.line("Lost your face for a moment.", "line accent");
      term.line("Center yourself and close your eyes to continue.", "line dim");
      interrupted = true;
      // Treat a tracking dropout the same as an open-eyes interruption for recovery purposes,
      // but don't count it toward the eyes-opened tally.
    },
  );

  await new Promise<void>((resolve) => {
    const check = () => {
      if (ended) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });

  tracker.stop();
  tracker.stopCamera();
  monitorEl.hidden = true;
  exitDark();

  const totalSessionSec = (performance.now() - sessionStartedAt) / 1000;

  term.clear();
  term.setStatus("");
  await term.type("Thanks for listening.");
  await sleep(500);

  await showReport({
    title: track.title,
    artist: track.artist,
    year: track.year,
    accent: track.accent,
    durationSec: audio.duration,
    totalSessionSec,
    peeks,
    eyesOpenedCount,
    honorMode: false,
    sessionSerial: serial,
  });

  // ---- inner helpers ----

  async function waitForFace(timeoutMs = 8000): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = performance.now() + timeoutMs;
      let settled = false;
      tracker.start(
        (state) => {
          if (settled) return;
          if (state.faceDetected) {
            settled = true;
            tracker.stop();
            resolve(true);
          } else if (performance.now() > deadline) {
            settled = true;
            tracker.stop();
            resolve(false);
          }
        },
        () => {
          // initial acquisition has its own deadline above; ignore the tracker's own grace timer here
        },
      );
    });
  }

  async function rehearseClosedEyes(holdMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let closedSince: number | null = null;
      const timeoutAt = performance.now() + 20000;

      tracker.start(
        (state) => {
          const now = performance.now();
          if (now > timeoutAt) {
            tracker.stop();
            resolve(false);
            return;
          }
          if (state.closed) {
            if (closedSince === null) closedSince = now;
            const held = now - closedSince;
            term.setStatus(`holding… ${Math.min(holdMs, held).toFixed(0)}ms / ${holdMs}ms`);
            if (held >= holdMs) {
              tracker.stop();
              resolve(true);
            }
          } else {
            closedSince = null;
            term.setStatus("open your eyes reset the timer");
          }
        },
        () => {},
      );
    });
  }

  function enterDark(): void {
    voidEl.classList.add("on");
  }

  function exitDark(): void {
    voidEl.classList.remove("on");
  }

  async function showReport(data: SessionData): Promise<void> {
    term.clear();
    const wrap = document.createElement("div");
    wrap.className = "report";
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);

    const actions = document.createElement("div");
    actions.className = "report-actions";

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "term-btn";
    downloadBtn.textContent = "Download";
    actions.appendChild(downloadBtn);

    let shareBtn: HTMLButtonElement | null = null;
    if ("share" in navigator) {
      shareBtn = document.createElement("button");
      shareBtn.className = "term-btn";
      shareBtn.textContent = "Share";
      actions.appendChild(shareBtn);
    }

    const againBtn = document.createElement("button");
    againBtn.className = "term-btn";
    againBtn.textContent = "Run it again";
    actions.appendChild(againBtn);

    wrap.appendChild(actions);
    term.mount(wrap);

    await renderReportCard(canvas, data);

    downloadBtn.addEventListener("click", async () => {
      const blob = await exportPNG(canvas);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ghostframe-session.png";
      a.click();
      URL.revokeObjectURL(url);
    });

    shareBtn?.addEventListener("click", async () => {
      const blob = await exportPNG(canvas);
      const file = new File([blob], "ghostframe-session.png", { type: "image/png" });
      try {
        if (!("canShare" in navigator) || navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: "GHOSTFRAME",
            text: `I just listened to ${data.title} with my eyes closed.`,
          });
        }
      } catch {
        // user cancelled share sheet — nothing to do
      }
    });

    againBtn.addEventListener("click", () => location.reload());
  }

  async function runHonorMode(): Promise<void> {
    audio.unlock();
    term.clear();
    await term.type("Close your eyes. I'm trusting you.");
    await sleep(REDUCED_MOTION ? 200 : 2200);
    enterDark();
    const start = performance.now();
    await audio.start();

    await new Promise<void>((resolve) => {
      audio.onEnded(() => resolve());
    });

    exitDark();
    const totalSessionSec = (performance.now() - start) / 1000;
    term.clear();
    await term.type("Thanks for listening.");
    await sleep(400);

    await showReport({
      title: track.title,
      artist: track.artist,
      year: track.year,
      accent: track.accent,
      durationSec: audio.duration,
      totalSessionSec,
      peeks: [],
      eyesOpenedCount: 0,
      honorMode: true,
      sessionSerial: serial,
    });
  }
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app")!;
  app.innerHTML = `<div class="terminal"><p class="line accent">Something went wrong. Reload to try again.</p></div>`;
});
