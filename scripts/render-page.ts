// Headless render page used by scripts/generate-asset.ts. Loaded inside
// a Playwright Chromium instance; the CLI calls window.__renderAsset(...)
// after the page is ready and reads the resulting PNG data URL.
//
// Lighting + camera mirror src/assetlab.ts (the dev tool used to iterate
// on prop generation) so the CLI's stills look like what you'd see in
// the lab. Background is transparent — the PNG is meant to be composed
// onto whatever surface a docs page or catalog UI wants.

import * as THREE from "three";
import { renderSpec } from "../src/assets/render";
import type { AssetSpec } from "../server/protocol.ts";

declare global {
  interface Window {
    __renderAsset: (args: {
      spec: AssetSpec;
      size: number;
      mountKind: "cosmetic" | "prop";
    }) => string;
  }
}

window.__renderAsset = ({ spec, size, mountKind }) => {
  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  canvas.width = size;
  canvas.height = size;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  const keyLight = new THREE.DirectionalLight(0xfff2d8, 1.4);
  keyLight.position.set(3, 4, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.5);
  fillLight.position.set(-4, -1, 3);
  scene.add(fillLight);

  const group = renderSpec(spec);
  scene.add(group);

  // Auto-frame: fit the asset's bounding sphere into a fixed FOV with a
  // little padding so the silhouette doesn't kiss the canvas edges.
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.5);

  const fovDeg = 35;
  const fov = (fovDeg * Math.PI) / 180;
  const camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.1, 100);
  // Distance to fit the bounding sphere with ~15% margin.
  const dist = (radius / Math.sin(fov / 2)) * 1.15;

  // Camera orbits 45° around Y for a 3/4 view (front-right), with a
  // slight elevation on props so they read three-dimensional. Cosmetics
  // stay eye-level so a hat brim doesn't disappear behind itself.
  const elevation = mountKind === "prop" ? 0.18 : 0.0;
  const offsetY = dist * elevation;
  const yaw = Math.PI / 4;
  camera.position.set(
    center.x + Math.sin(yaw) * dist,
    center.y + offsetY,
    center.z + Math.cos(yaw) * dist,
  );
  camera.lookAt(center);

  renderer.render(scene, camera);
  return canvas.toDataURL("image/png");
};

// Signal readiness so the CLI doesn't have to poll for the function.
(window as unknown as { __renderReady: boolean }).__renderReady = true;
