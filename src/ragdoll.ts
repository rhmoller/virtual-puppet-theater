import * as THREE from "three";
import { Puppet } from "./puppet";

// Segment dimensions — must match puppet.ts.
const TORSO_R = 0.55;
const TORSO_LEN = 1.4;
const UPPER_R = 0.18;
const UPPER_LEN = 0.8;
const LOWER_R = 0.15;
const LOWER_LEN = 0.75;
const TORSO_L = TORSO_LEN + TORSO_R * 2;
const UPPER_L = UPPER_LEN + UPPER_R * 2;
const LOWER_L = LOWER_LEN + LOWER_R * 2;

// Joint anchor offsets in puppet-root local space.
const NECK_LX = 0;
const NECK_LY = -1;
const SHOULDER_LY = -1.15;
const SHOULDER_LX = 0.55;

type P = { cur: THREE.Vector2; prev: THREE.Vector2 };

/**
 * Verlet rag-doll for a Puppet. Runs in world space so that when the root
 * moves, the chain lags behind (creating a dangle) and gravity pulls the
 * free ends down regardless of the head's roll.
 */
export class Ragdoll {
  private torsoTip: P;
  private leftElbow: P;
  private leftHand: P;
  private rightElbow: P;
  private rightHand: P;
  private initialized = false;

  private gravity = new THREE.Vector2(0, -18);
  private damping = 0.985;
  private iterations = 6;

  constructor(private puppet: Puppet) {
    const mk = (): P => ({
      cur: new THREE.Vector2(),
      prev: new THREE.Vector2(),
    });
    this.torsoTip = mk();
    this.leftElbow = mk();
    this.leftHand = mk();
    this.rightElbow = mk();
    this.rightHand = mk();
  }

  /** Call when the puppet is re-shown after being hidden, so the chain
   *  snaps to the anchors instead of swinging in from its last position. */
  reset() {
    this.initialized = false;
  }

  update(dt: number) {
    const root = this.puppet.root;
    const scale = root.scale.y;
    const cosR = Math.cos(root.rotation.z);
    const sinR = Math.sin(root.rotation.z);
    const rx = root.position.x;
    const ry = root.position.y;

    // Anchor world positions (neck + two shoulders).
    const toWorld = (lx: number, ly: number): THREE.Vector2 =>
      new THREE.Vector2(
        rx + (cosR * lx - sinR * ly) * scale,
        ry + (sinR * lx + cosR * ly) * scale,
      );
    const neckW = toWorld(NECK_LX, NECK_LY);
    const lsW = toWorld(-SHOULDER_LX, SHOULDER_LY);
    const rsW = toWorld(SHOULDER_LX, SHOULDER_LY);

    // Scale rest lengths to world space.
    const torsoLw = TORSO_L * scale;
    const upperLw = UPPER_L * scale;
    const lowerLw = LOWER_L * scale;

    if (!this.initialized) {
      this.torsoTip.cur.set(neckW.x, neckW.y - torsoLw);
      this.leftElbow.cur.set(lsW.x, lsW.y - upperLw);
      this.leftHand.cur.set(lsW.x, lsW.y - upperLw - lowerLw);
      this.rightElbow.cur.set(rsW.x, rsW.y - upperLw);
      this.rightHand.cur.set(rsW.x, rsW.y - upperLw - lowerLw);
      for (const p of this.particles()) p.prev.copy(p.cur);
      this.initialized = true;
    }

    // Verlet integration.
    const dt2 = dt * dt;
    for (const p of this.particles()) {
      const vx = (p.cur.x - p.prev.x) * this.damping;
      const vy = (p.cur.y - p.prev.y) * this.damping;
      p.prev.copy(p.cur);
      p.cur.x += vx + this.gravity.x * dt2;
      p.cur.y += vy + this.gravity.y * dt2;
    }

    // Distance constraints (multiple passes for stiffness).
    const pinTo = (p: P, ax: number, ay: number, L: number) => {
      const dx = p.cur.x - ax;
      const dy = p.cur.y - ay;
      const d = Math.hypot(dx, dy) || 1e-6;
      const r = L / d;
      p.cur.x = ax + dx * r;
      p.cur.y = ay + dy * r;
    };
    const link = (a: P, b: P, L: number) => {
      const dx = b.cur.x - a.cur.x;
      const dy = b.cur.y - a.cur.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const r = L / d;
      b.cur.x = a.cur.x + dx * r;
      b.cur.y = a.cur.y + dy * r;
    };
    for (let i = 0; i < this.iterations; i++) {
      pinTo(this.torsoTip, neckW.x, neckW.y, torsoLw);
      pinTo(this.leftElbow, lsW.x, lsW.y, upperLw);
      link(this.leftElbow, this.leftHand, lowerLw);
      pinTo(this.rightElbow, rsW.x, rsW.y, upperLw);
      link(this.rightElbow, this.rightHand, lowerLw);
    }

    // Torso stabilizer: pull the torso tip toward the rest direction (the
    // root's local -Y, rotated by the root's roll) so the body self-rights
    // instead of swinging freely like the arms.
    const torsoStiff = 0.05;
    const restTipX = neckW.x + sinR * torsoLw;
    const restTipY = neckW.y - cosR * torsoLw;
    this.torsoTip.cur.x += (restTipX - this.torsoTip.cur.x) * torsoStiff;
    this.torsoTip.cur.y += (restTipY - this.torsoTip.cur.y) * torsoStiff;
    // Re-apply the length constraint after the nudge.
    pinTo(this.torsoTip, neckW.x, neckW.y, torsoLw);

    // Convert world positions back to local segment rotations. Each segment
    // group's mesh extends along its local -Y, so a rotation θ makes -Y
    // point in world direction (sin(θ), -cos(θ)). For a given desired world
    // direction (wx, wy), the needed world rotation is atan2(wx, -wy);
    // subtract the parent's composed world rotation to get the local value.
    const rootA = root.rotation.z;
    const dirAngle = (fromX: number, fromY: number, toX: number, toY: number) =>
      Math.atan2(toX - fromX, -(toY - fromY));

    this.puppet.torso.rotation.z =
      dirAngle(neckW.x, neckW.y, this.torsoTip.cur.x, this.torsoTip.cur.y) - rootA;
    this.puppet.leftShoulder.rotation.z =
      dirAngle(lsW.x, lsW.y, this.leftElbow.cur.x, this.leftElbow.cur.y) - rootA;
    this.puppet.rightShoulder.rotation.z =
      dirAngle(rsW.x, rsW.y, this.rightElbow.cur.x, this.rightElbow.cur.y) - rootA;

    const lsA = this.puppet.leftShoulder.rotation.z;
    const rsA = this.puppet.rightShoulder.rotation.z;
    this.puppet.leftElbow.rotation.z =
      dirAngle(
        this.leftElbow.cur.x, this.leftElbow.cur.y,
        this.leftHand.cur.x, this.leftHand.cur.y,
      ) - rootA - lsA;
    this.puppet.rightElbow.rotation.z =
      dirAngle(
        this.rightElbow.cur.x, this.rightElbow.cur.y,
        this.rightHand.cur.x, this.rightHand.cur.y,
      ) - rootA - rsA;
  }

  private *particles(): Generator<P> {
    yield this.torsoTip;
    yield this.leftElbow;
    yield this.leftHand;
    yield this.rightElbow;
    yield this.rightHand;
  }
}
