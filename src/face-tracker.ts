import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

export interface EyeState {
  closed: boolean;
  faceDetected: boolean;
  closedness: number;
}

const DWELL_MS = 450;
const FACE_LOST_GRACE_MS = 2500;

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private raf = 0;
  private lastVideoTime = -1;

  private closedThreshold = 0.55;
  private openThreshold = 0.35;

  private candidate: boolean | null = null;
  private candidateSince = 0;
  private stableClosed = false;

  private lastFaceSeenAt = 0;
  private brightnessCanvas: HTMLCanvasElement;
  private brightnessCtx: CanvasRenderingContext2D;

  constructor(private video: HTMLVideoElement) {
    this.brightnessCanvas = document.createElement("canvas");
    this.brightnessCanvas.width = 16;
    this.brightnessCanvas.height = 12;
    this.brightnessCtx = this.brightnessCanvas.getContext("2d", {
      willReadFrequently: true,
    })!;
  }

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(
      `${import.meta.env.BASE_URL}wasm`,
    );
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
  }

  async requestCamera(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
  }

  stopCamera(): void {
    const stream = this.video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
  }

  /**
   * Hard safety bounds regardless of what calibration computes — a bad calibration
   * reading must never produce a pair of thresholds the live gate can't actually reach.
   */
  setThresholds(closed: number, open: number): void {
    const safeOpen = Math.min(Math.max(open, 0.08), 0.55);
    const safeClosed = Math.min(Math.max(closed, safeOpen + 0.1), 0.85);
    this.openThreshold = safeOpen;
    this.closedThreshold = safeClosed;
  }

  /** Samples raw closedness over a fixed window. Used during calibration. */
  async sampleClosedness(
    durationMs: number,
    onTick?: (fractionDone: number) => void,
  ): Promise<number> {
    const samples: number[] = [];
    const start = performance.now();
    let elapsed = 0;
    while (elapsed < durationMs) {
      const v = this.detectOnce();
      if (v !== null) samples.push(v);
      onTick?.(Math.min(1, elapsed / durationMs));
      await new Promise((r) => requestAnimationFrame(r));
      elapsed = performance.now() - start;
    }
    if (samples.length === 0) return 0;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }

  sampleBrightness(): number {
    const w = this.brightnessCanvas.width;
    const h = this.brightnessCanvas.height;
    this.brightnessCtx.drawImage(this.video, 0, 0, w, h);
    const { data } = this.brightnessCtx.getImageData(0, 0, w, h);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return total / (data.length / 4) / 255;
  }

  start(onState: (state: EyeState) => void, onFaceLostTooLong: () => void): void {
    this.lastFaceSeenAt = performance.now();
    this.stableClosed = false;
    this.candidate = null;

    const loop = () => {
      const raw = this.detectOnce();
      const nowMs = performance.now();
      const faceDetected = raw !== null;

      if (faceDetected) {
        this.lastFaceSeenAt = nowMs;
        const candidate =
          raw! >= this.closedThreshold
            ? true
            : raw! <= this.openThreshold
              ? false
              : this.stableClosed;

        if (candidate !== this.candidate) {
          this.candidate = candidate;
          this.candidateSince = nowMs;
        } else if (
          candidate !== this.stableClosed &&
          nowMs - this.candidateSince >= DWELL_MS
        ) {
          this.stableClosed = candidate;
        }

        onState({ closed: this.stableClosed, faceDetected: true, closedness: raw! });
      } else {
        onState({ closed: this.stableClosed, faceDetected: false, closedness: 0 });
        if (nowMs - this.lastFaceSeenAt > FACE_LOST_GRACE_MS) {
          onFaceLostTooLong();
          this.lastFaceSeenAt = nowMs;
        }
      }

      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private detectOnce(): number | null {
    if (!this.landmarker) return null;
    if (this.video.currentTime === this.lastVideoTime) return null;
    if (this.video.readyState < 2) return null;
    this.lastVideoTime = this.video.currentTime;
    const result = this.landmarker.detectForVideo(this.video, performance.now());
    return this.extractClosedness(result);
  }

  private extractClosedness(result: FaceLandmarkerResult): number | null {
    const shapes = result.faceBlendshapes?.[0]?.categories;
    if (!shapes || shapes.length === 0) return null;
    const left = shapes.find((c) => c.categoryName === "eyeBlinkLeft")?.score ?? 0;
    const right = shapes.find((c) => c.categoryName === "eyeBlinkRight")?.score ?? 0;
    return (left + right) / 2;
  }
}
