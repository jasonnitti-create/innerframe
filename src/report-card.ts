export type SessionMode = "completed" | "honor" | "exited";

export interface SessionData {
  title: string;
  artist: string;
  year: string;
  accent: string;
  durationSec: number;
  totalSessionSec: number;
  peeks: number[];
  eyesOpenedCount: number;
  mode: SessionMode;
  exitedAtSec?: number;
  sessionSerial: string;
}

const MONO = "'IBM Plex Mono', monospace";
const W = 1200;
const H = 675;
// A fixed alarm red, independent of the track's accent color — signals
// "terminated" the same way across every track rather than competing with it.
const EXIT_COLOR = "#ff4d4d";

export async function renderReportCard(
  canvas: HTMLCanvasElement,
  data: SessionData,
): Promise<void> {
  await document.fonts.load(`600 40px ${MONO}`);
  await document.fonts.load(`22px ${MONO}`);
  await document.fonts.load(`13px ${MONO}`);

  const scale = Math.max(2, window.devicePixelRatio || 1);
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#1c1c1c";
  ctx.lineWidth = 1;
  ctx.strokeRect(24.5, 24.5, W - 49, H - 49);

  ctx.fillStyle = "#e8e8e0";
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText("INNERFRAME", 56, 74);

  ctx.fillStyle = "#6b6b64";
  ctx.font = `13px ${MONO}`;
  const serialWidth = ctx.measureText(data.sessionSerial).width;
  ctx.fillText(data.sessionSerial, W - 56 - serialWidth, 74);

  ctx.fillStyle = data.accent;
  ctx.font = `600 40px ${MONO}`;
  ctx.fillText(data.title.toUpperCase(), 56, 152);

  ctx.fillStyle = "#9a9a92";
  ctx.font = `18px ${MONO}`;
  ctx.fillText(`${data.artist} · ${data.year}`, 56, 182);

  const pct = Math.round(
    (data.durationSec / Math.max(data.totalSessionSec, 1)) * 100,
  );

  let stats: [string, string][];
  if (data.mode === "honor") {
    stats = [
      ["MODE", "HONOR SYSTEM"],
      ["RUNTIME", fmt(data.durationSec)],
    ];
  } else if (data.mode === "exited") {
    stats = [
      ["MODE", "LEFT EARLY"],
      ["EYES OPENED", String(data.eyesOpenedCount)],
      ["LEFT AT", `${fmt(data.exitedAtSec ?? 0)} / ${fmt(data.durationSec)}`],
    ];
  } else {
    stats = [
      ["EYES OPENED", String(data.eyesOpenedCount)],
      ["SESSION TIME", `${fmt(data.totalSessionSec)} / ${fmt(data.durationSec)}`],
      ["IMAGINED", `${pct}%`],
    ];
  }

  let y = 250;
  for (const [label, value] of stats) {
    ctx.fillStyle = "#6b6b64";
    ctx.font = `13px ${MONO}`;
    ctx.fillText(label, 56, y);
    ctx.fillStyle = label === "MODE" && data.mode === "exited" ? EXIT_COLOR : "#e8e8e0";
    ctx.font = `600 24px ${MONO}`;
    ctx.fillText(value, 56, y + 30);
    y += 70;
  }

  const tlX = 56;
  const tlY = H - 100;
  const tlW = W - 112;

  const showTimeline = data.mode !== "honor";

  if (showTimeline) {
    const caption =
      data.mode !== "exited" && data.peeks.length === 0
        ? "NO INTERRUPTIONS — FULLY IMAGINED"
        : "SIGNAL TIMELINE";
    ctx.fillStyle = data.mode !== "exited" && data.peeks.length === 0 ? data.accent : "#6b6b64";
    ctx.font = `13px ${MONO}`;
    ctx.fillText(caption, tlX, tlY - 40);
  }

  ctx.strokeStyle = "#2a2a26";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tlX, tlY);
  ctx.lineTo(tlX + tlW, tlY);
  ctx.stroke();

  // Collision-avoidance for peek timestamp labels: skip a label rather than
  // let it overlap the previous one when two interruptions land close together.
  let lastLabelRight = -Infinity;
  const labelGap = 6;

  function drawTimeLabel(t: number, color: string): void {
    const x = tlX + (t / Math.max(data.durationSec, 1)) * tlW;
    const label = fmt(t);
    const lw = ctx.measureText(label).width;
    const labelX = clamp(x - lw / 2, tlX, tlX + tlW - lw);
    if (labelX < lastLabelRight + labelGap) return;
    ctx.fillStyle = color;
    ctx.fillText(label, labelX, tlY - 30);
    lastLabelRight = labelX + lw;
  }

  if (showTimeline && data.peeks.length > 0) {
    const showLabels = data.peeks.length <= 5;
    ctx.save();
    ctx.shadowColor = data.accent;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = data.accent;
    ctx.fillStyle = data.accent;
    ctx.lineWidth = 1.5;
    for (const t of data.peeks) {
      const x = tlX + (t / Math.max(data.durationSec, 1)) * tlW;
      ctx.beginPath();
      ctx.moveTo(x, tlY);
      ctx.lineTo(x, tlY - 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, tlY - 20, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (showLabels) {
      ctx.font = `11px ${MONO}`;
      for (const t of data.peeks) {
        drawTimeLabel(t, "#9a9a92");
      }
    }
  }

  if (data.mode === "exited" && data.exitedAtSec !== undefined) {
    const ex = tlX + (data.exitedAtSec / Math.max(data.durationSec, 1)) * tlW;
    ctx.save();
    ctx.shadowColor = EXIT_COLOR;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = EXIT_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(ex, tlY - 20);
    ctx.lineTo(ex, tlY + 6);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = "#4a4a44";
  ctx.font = `12px ${MONO}`;
  ctx.fillText("0:00", tlX, tlY + 24);
  const totalStr = fmt(data.durationSec);
  ctx.fillText(totalStr, tlX + tlW - ctx.measureText(totalStr).width, tlY + 24);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function exportPNG(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob failed"));
    }, "image/png");
  });
}

function fmt(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
