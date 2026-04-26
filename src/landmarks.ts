// src/landmarks.ts — Debug-canvas drawing of MediaPipe hand landmarks.
// Owns the 200×150 overlay canvas and the two helpers that render each
// detected hand's skeleton, gaze ray, and landmark dots onto it.

import type { NormalizedLandmarkList } from "@mediapipe/hands";

type HandLabel = "Left" | "Right";

const landmarkCanvas = document.getElementById("landmark-canvas") as HTMLCanvasElement;
const landmarkCtx = landmarkCanvas.getContext("2d")!;
landmarkCanvas.width = 200;
landmarkCanvas.height = 150;

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 17],
];

const COLORS: Record<HandLabel, string> = { Left: "#d98b4f", Right: "#7fb3a0" };

function drawHandLandmarks(lm: NormalizedLandmarkList, color: string) {
  const ctx = landmarkCtx;
  const w = landmarkCanvas.width;
  const h = landmarkCanvas.height;

  // Connections
  ctx.strokeStyle = color + "99";
  ctx.lineWidth = 1;
  for (const conn of HAND_CONNECTIONS) {
    const la = lm[conn[0] as number];
    const lb = lm[conn[1] as number];
    if (!la || !lb) continue;
    // Mirror x only to match the horizontally-flipped video.
    const x0 = (1 - la.x) * w;
    const y0 = la.y * h;
    const x1 = (1 - lb.x) * w;
    const y1 = lb.y * h;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Middle finger MCP→tip (gaze direction).
  const middleMcp = lm[9];
  const middleTip = lm[12];
  if (middleMcp && middleTip) {
    const gx0 = (1 - middleMcp.x) * w;
    const gy0 = middleMcp.y * h;
    const gx1 = (1 - middleTip.x) * w;
    const gy1 = middleTip.y * h;
    ctx.beginPath();
    ctx.moveTo(gx0, gy0);
    ctx.lineTo(gx1, gy1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Wrist, thumb tip, middle tip highlights.
  ctx.fillStyle = color;
  for (const idx of [0, 4, 12] as const) {
    const pt = lm[idx];
    if (!pt) continue;
    const x = (1 - pt.x) * w;
    const y = pt.y * h;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Landmark dots.
  ctx.fillStyle = color;
  for (const pt of lm) {
    if (!pt) continue;
    const x = (1 - pt.x) * w;
    const y = pt.y * h;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawLandmarks(
  handData: { lm: NormalizedLandmarkList; hand: HandLabel } | null,
) {
  const w = landmarkCanvas.width;
  const h = landmarkCanvas.height;
  landmarkCtx.clearRect(0, 0, w, h);
  if (!handData) return;
  drawHandLandmarks(handData.lm, COLORS[handData.hand]);
}
