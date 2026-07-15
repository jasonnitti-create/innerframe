# INNERFRAME

An interactive listening experience: a song that only plays while your eyes are closed. Open them, and it stops. Close them again, and it picks up where it left off. The video is whatever you imagine — nothing is ever shown.

Eye state is read on-device with [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) blendshapes. The camera feed never leaves the browser — no upload, no recording, no server.

## Stack

- Vite + TypeScript, no framework
- `@mediapipe/tasks-vision`, self-hosted (wasm + model live under `public/`, no CDN dependency)
- Web Audio API for gap-free pause/resume
- Canvas-rendered, downloadable/shareable session report

## Running locally

```
npm install
npm run dev
```

## Swapping in a different track

Edit `public/track.json`:

```json
{
  "title": "…",
  "artist": "…",
  "year": "…",
  "audioSrc": "./audio/yourtrack.mp3",
  "accent": "#39ff6a"
}
```

Drop the audio file in `public/audio/`. That's the whole artist-facing surface — this is meant to become a template any artist can drop their own track into.
