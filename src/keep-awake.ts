// Phones auto-lock after 30–60 seconds without a touch, and a locked screen
// suspends both the camera and the audio. Eyes closed means no touches, so
// without this the song dies a minute in. Hold a screen wake lock for the
// whole session and re-take it whenever the page comes back into view (the
// browser drops the lock on its own when the page is hidden).

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    // Refused (battery saver, no user activation). The session still runs;
    // the phone may just sleep on its own schedule.
  }
}

document.addEventListener("visibilitychange", () => {
  if (wanted && !sentinel && document.visibilityState === "visible") void acquire();
});

export const keepAwake = {
  start(): void {
    wanted = true;
    if (!sentinel) void acquire();
  },
  stop(): void {
    wanted = false;
    void sentinel?.release();
    sentinel = null;
  },
};
