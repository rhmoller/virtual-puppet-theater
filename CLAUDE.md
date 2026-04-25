# Hackathon

A virtual puppet theater that runs in your browser.
Webcam based hand tracking with mediapipe.

Created for the "Built with Opus" hackathon.

## Stack

- **Bun** — package manager and runtime
- **Vite** — dev server and bundler
- **TypeScript** — strict mode, bundler resolution
- **@mediapipe/hands** — hand landmark detection

## Commands

- `bun run dev` — start Vite dev server
- `bun run build` — type-check and build for production
- `bun run preview` — preview the production build

## Architecture notes

- `@mediapipe/hands` ships as a UMD bundle and does not work with Vite's ESM pre-bundler. The runtime is loaded from the jsDelivr CDN via a `<script>` tag in `index.html`, exposing `window.Hands` and `window.HAND_CONNECTIONS`. The npm package is kept only for TypeScript types (see `src/main.ts` global declarations).
- WASM assets (`hands_solution_simd_wasm_bin.*`, `.tflite` models, `hands.binarypb`) are fetched from the same CDN via the `locateFile` callback.
- MediaPipe's WASM runtime writes informational logs (GL context, version) to `console.log`. These are not errors.
- `getUserMedia` requires HTTPS or `localhost`.

## Layout

- `index.html` — entry, loads MediaPipe CDN script and the app module
- `src/main.ts` — webcam capture, MediaPipe setup, render loop drawing landmarks to canvas

## Commit

Use conventional commit messages. Don't mix unrelated changes into one changeset.

## Deploy

Never deploy unless explicitly requested. No `flyctl deploy`, no production pushes, no live-site changes without a clear instruction in the current request. "Build", "test", "ship", "land" are not deploy authorizations on their own.
