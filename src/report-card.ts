export interface SessionData {
  title: string;
  artist: string;
  year: string;
  accent: string;
  durationSec: number;
  totalSessionSec: number;
  peeks: number[];
  eyesOpenedCount: number;
  honorMode: boolean;
  sessionSerial: string;
}

const MONO = "'IBM Plex Mono', monospace";
const W = 1200;
const H = 675;

export async function renderReportCard(
  canvas: HTMLCanvasElement,
  data: SessionData,
): Promise<void> {
  await document.fonts.load(`600 40px ${MONO}`);
  await document.fonts.load(`22px ${MONO}`);
  await document.fonts.load(`13px ${MONO}`);

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#1c1c1c";
  ctx.lineWidth = 1;
  ctx.strokeRect(24.5, 24.5, W - 49, H - 49);

  ctx.fillStyle = "#e8e8e0";
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText("GHOSTFRAME", 56, 74);

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

  const stats: [string, string][] = data.honorMode
    ? [
        ["MODE", "HONOR SYSTEM"],
        ["RUNTIME", fmt(data.durationSec)],
      ]
    : [
        ["EYES OPENED", String(data.eyesOpenedCount)],
        ["SESSION TIME", `${fmt(data.totalSessionSec)} / ${fmt(data.durationSec)}`],
        ["IMAGINED", `${pct}%`],
      ];

  let y = 250;
  for (const [label, value] of stats) {
    ctx.fillStyle = "#6b6b64";
    ctx.font = `13px ${MONO}`;
    ctx.fillText(label, 56, y);
    ctx.fillStyle = "#e8e8e0";
    ctx.font = `600 24px ${MONO}`;
    ctx.fillText(value, 56, y + 30);
    y += 70;
  }

  const tlX = 56;
  const tlY = H - 110;
  const tlW = W - 112;

  ctx.strokeStyle = "#2a2a26";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tlX, tlY);
  ctx.lineTo(tlX + tlW, tlY);
  ctx.stroke();

  if (!data.honorMode) {
    ctx.fillStyle = data.accent;
    for (const t of data.peeks) {
      const x = tlX + (t / Math.max(data.durationSec, 1)) * tlW;
      ctx.fillRect(x - 1, tlY - 8, 2, 16);
    }
  }

  ctx.fillStyle = "#4a4a44";
  ctx.font = `12px ${MONO}`;
  ctx.fillText("0:00", tlX, tlY + 24);
  const totalStr = fmt(data.durationSec);
  ctx.fillText(totalStr, tlX + tlW - ctx.measureText(totalStr).width, tlY + 24);
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
