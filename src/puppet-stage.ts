import * as THREE from "three";
import type { Emotion, Gesture } from "../server/protocol.ts";
import { Puppet, PUPPET_THEMES } from "./puppet";

// Stage puppet: an AI-driven hand-puppet built on the same rig as the
// user puppet. Inherits the sphere head + split-jaw mouth + ragdoll-able
// arm hierarchy from Puppet, layers emotion/gesture/speaking animation
// on top, and adds a small visual variation (visible ears) so the
// character reads as distinct from the user puppet at a glance.

type EmotionParams = {
  eyeScaleY: number;
  rockSpeed: number;
  rockAmp: number;
  bodyTiltZ: number;
  bodyOffsetZ: number;
  armAmp: number;
  blinkRate: number;
  blinkSuppress: number;
  browInner: number;
  browOuter: number;
  browAngle: number;
  headTiltZ: number;
};

const EMOTIONS: Record<Emotion, EmotionParams> = {
  neutral: {
    eyeScaleY: 1.0,
    rockSpeed: 1.0,
    rockAmp: 1.0,
    bodyTiltZ: 0.0,
    bodyOffsetZ: 0.0,
    armAmp: 1.0,
    blinkRate: 1.0,
    blinkSuppress: 0,
    browInner: 0,
    browOuter: 0,
    browAngle: 0,
    headTiltZ: 0,
  },
  smug: {
    eyeScaleY: 0.75,
    rockSpeed: 0.7,
    rockAmp: 0.9,
    bodyTiltZ: 0.06,
    bodyOffsetZ: 0.0,
    armAmp: 0.8,
    blinkRate: 0.6,
    blinkSuppress: 0,
    browInner: -0.04,
    browOuter: 0.04,
    browAngle: 0.25,
    headTiltZ: 0.08,
  },
  curious: {
    eyeScaleY: 1.1,
    rockSpeed: 0.9,
    rockAmp: 0.6,
    bodyTiltZ: 0.0,
    bodyOffsetZ: 0.0,
    armAmp: 0.7,
    blinkRate: 1.4,
    blinkSuppress: 0,
    browInner: 0.05,
    browOuter: 0.08,
    browAngle: 0.1,
    headTiltZ: 0.14,
  },
  excited: {
    eyeScaleY: 1.15,
    rockSpeed: 1.8,
    rockAmp: 1.4,
    bodyTiltZ: 0.0,
    bodyOffsetZ: 0.0,
    armAmp: 1.6,
    blinkRate: 0.3,
    blinkSuppress: 0,
    browInner: 0.08,
    browOuter: 0.08,
    browAngle: 0,
    headTiltZ: 0,
  },
  bored: {
    eyeScaleY: 0.55,
    rockSpeed: 0.4,
    rockAmp: 0.5,
    bodyTiltZ: -0.04,
    bodyOffsetZ: 0.0,
    armAmp: 0.4,
    blinkRate: 0.3,
    blinkSuppress: 0,
    browInner: -0.05,
    browOuter: -0.05,
    browAngle: -0.1,
    headTiltZ: -0.05,
  },
  surprised: {
    eyeScaleY: 1.5,
    rockSpeed: 1.0,
    rockAmp: 0.2,
    bodyTiltZ: 0.0,
    bodyOffsetZ: -0.1,
    armAmp: 0.2,
    blinkRate: 1.0,
    blinkSuppress: 1.0,
    browInner: 0.14,
    browOuter: 0.14,
    browAngle: 0,
    headTiltZ: 0,
  },
};

type GestureSpec = {
  duration: number;
  apply: (t: number, rig: GestureRig) => void;
};

type GestureRig = {
  leftShoulder: THREE.Group;
  rightShoulder: THREE.Group;
  root: THREE.Group;
  headGroup: THREE.Group;
};

function envelope(t: number, dur: number): number {
  const p = t / dur;
  const e = 0.2;
  if (p < e) return p / e;
  if (p > 1 - e) return (1 - p) / e;
  return 1;
}

const GESTURES: Record<Gesture, GestureSpec | null> = {
  none: null,
  wave: {
    duration: 1.2,
    apply(t, { rightShoulder }) {
      const env = envelope(t, 1.2);
      rightShoulder.rotation.z += -1.8 * env;
      rightShoulder.rotation.x += Math.sin(t * Math.PI * 2 * 2.5) * 0.6 * env;
    },
  },
  shrug: {
    duration: 0.8,
    apply(t, { leftShoulder, rightShoulder, root }) {
      const env = envelope(t, 0.8);
      leftShoulder.rotation.z += -0.5 * env;
      rightShoulder.rotation.z += 0.5 * env;
      root.position.y -= 0.05 * env;
    },
  },
  lean_in: {
    duration: 1.0,
    apply(t, { root }) {
      const env = envelope(t, 1.0);
      root.position.z += 0.35 * env;
    },
  },
  nod: {
    duration: 0.8,
    apply(t, { headGroup }) {
      const env = envelope(t, 0.8);
      headGroup.rotation.x += Math.sin(t * Math.PI * 2 * 2.5) * 0.25 * env;
    },
  },
  shake: {
    duration: 0.7,
    apply(t, { headGroup }) {
      const env = envelope(t, 0.7);
      headGroup.rotation.y += Math.sin(t * Math.PI * 2 * 4.3) * 0.3 * env;
    },
  },
  jump: {
    duration: 0.6,
    apply(t, { root }) {
      const p = t / 0.6;
      root.position.y += Math.sin(p * Math.PI) * 0.6;
    },
  },
  spin: {
    duration: 0.9,
    apply(t, { root }) {
      const p = Math.min(1, t / 0.9);
      const eased = 0.5 - 0.5 * Math.cos(p * Math.PI);
      root.rotation.y += eased * Math.PI * 2;
    },
  },
  wiggle: {
    duration: 1.0,
    apply(t, { root }) {
      const env = envelope(t, 1.0);
      root.rotation.z += Math.sin(t * Math.PI * 2 * 3.0) * 0.2 * env;
    },
  },
};

// Base rest rotation of the shoulder groups, set in Puppet's constructor:
// shoulder.rotation.z = sx * 0.15. Resetting to these each frame keeps
// idle-arm-wiggle and gesture deltas additive without accumulating.
const SHOULDER_REST_LZ = -0.15;
const SHOULDER_REST_RZ = 0.15;

/**
 * AI-driven hand-puppet rig. Subclasses Puppet so it inherits the
 * sphere-head split-jaw look; speaking drives the shared `setOpen`,
 * gestures animate the shared shoulder groups, emotion modulates brow
 * positions and eye scale on the inherited references. Distinct from
 * the user puppet via theme (lavender/mustard/teal) and small ears
 * added on top of the base rig.
 */
export class StagePuppet extends Puppet {
  private params: EmotionParams = { ...EMOTIONS.neutral };
  private targetParams: EmotionParams = { ...EMOTIONS.neutral };
  private blinkSuppress = 0;

  private gesture: Gesture = "none";
  private gestureT = 0;

  private speaking = false;
  private speakingEnv = 0;
  private speakingT = 0;

  private t = Math.random() * 10;
  private glanceX = 0;
  private glanceY = 0;

  // Inner-end y offset of brows. Brow base position is inherited from
  // Puppet (y=0.74); we layer emotion offsets on top.
  private static BROW_BASE_Y = 0.74;

  constructor() {
    super(PUPPET_THEMES.stage);

    // Variation: small visible ears. Puppet has none, so ears read as
    // a distinct silhouette element without conflicting with the head
    // cosmetic slot (which mounts above the skull).
    const skinMat = new THREE.MeshStandardMaterial({
      color: PUPPET_THEMES.stage.skin,
      roughness: 0.85,
    });
    const earGeom = new THREE.SphereGeometry(0.18, 14, 12);
    const leftEar = new THREE.Mesh(earGeom, skinMat);
    leftEar.position.set(-1.0, 0.1, 0);
    leftEar.scale.set(0.5, 1.1, 0.85);
    this.upperJaw.add(leftEar);
    const rightEar = new THREE.Mesh(earGeom, skinMat);
    rightEar.position.set(1.0, 0.1, 0);
    rightEar.scale.set(0.5, 1.1, 0.85);
    this.upperJaw.add(rightEar);
  }

  override setGaze(gx: number, gy: number) {
    // Persist for next update; the actual head/eye rotation is applied
    // in update() so it can layer with emotion-driven head tilt.
    this.glanceX = gx;
    this.glanceY = gy;
  }

  override setEmotion(emotion: Emotion) {
    this.targetParams = EMOTIONS[emotion];
    if (EMOTIONS[emotion].blinkSuppress > 0) {
      this.blinkSuppress = EMOTIONS[emotion].blinkSuppress;
    }
  }

  override playGesture(gesture: Gesture) {
    if (!GESTURES[gesture]) {
      this.gesture = "none";
      return;
    }
    this.gesture = gesture;
    this.gestureT = 0;
  }

  override setSpeaking(on: boolean) {
    this.speaking = on;
  }

  // setOpen is hand-tracking-driven on Puppet; on StagePuppet it's
  // entirely TTS-driven via setSpeaking. We override to no-op so any
  // accidental setOpen call from a controller doesn't fight the speaking
  // envelope.
  override setOpen(_amount: number): void {}

  override update(dt: number) {
    this.t += dt;
    this.blinkSuppress = Math.max(0, this.blinkSuppress - dt);

    // Ease emotion params toward target over ~300ms.
    const k = 1 - Math.exp(-dt / 0.3);
    const p = this.params;
    const tgt = this.targetParams;
    p.eyeScaleY += (tgt.eyeScaleY - p.eyeScaleY) * k;
    p.rockSpeed += (tgt.rockSpeed - p.rockSpeed) * k;
    p.rockAmp += (tgt.rockAmp - p.rockAmp) * k;
    p.bodyTiltZ += (tgt.bodyTiltZ - p.bodyTiltZ) * k;
    p.bodyOffsetZ += (tgt.bodyOffsetZ - p.bodyOffsetZ) * k;
    p.armAmp += (tgt.armAmp - p.armAmp) * k;
    p.blinkRate += (tgt.blinkRate - p.blinkRate) * k;
    p.browInner += (tgt.browInner - p.browInner) * k;
    p.browOuter += (tgt.browOuter - p.browOuter) * k;
    p.browAngle += (tgt.browAngle - p.browAngle) * k;
    p.headTiltZ += (tgt.headTiltZ - p.headTiltZ) * k;

    // Reset rotations that we layer on (position is set absolutely by
    // the AI controller each frame, so position deltas are naturally
    // single-frame; rotation we have to reset).
    this.root.rotation.set(0, 0, 0);
    this.headGroup.rotation.set(0, 0, 0);
    this.leftShoulder.rotation.set(0, 0, SHOULDER_REST_LZ);
    this.rightShoulder.rotation.set(0, 0, SHOULDER_REST_RZ);

    // Idle body sway via root rotation (subtle z-roll). Position bobble
    // already comes from the AI controller's rise animation.
    this.root.rotation.z =
      Math.sin(this.t * 1.1 * p.rockSpeed) * 0.04 * p.rockAmp + p.bodyTiltZ;

    // Gaze: head rotation comes from setGaze + emotion head tilt.
    const gx = Math.max(-1, Math.min(1, this.glanceX));
    const gy = Math.max(-1, Math.min(1, this.glanceY));
    this.headGroup.rotation.y = gx * 0.5;
    this.headGroup.rotation.x = -gy * 0.35;
    this.headGroup.rotation.z = p.headTiltZ;

    // Speaking envelope drives jaw open via the inherited setOpen on
    // upper/lower jaws. Use super to bypass our no-op override.
    this.speakingT += dt;
    this.speakingEnv +=
      ((this.speaking ? 1 : 0) - this.speakingEnv) * (1 - Math.exp(-dt / 0.09));
    const mouthPulse = 0.5 + 0.5 * Math.sin(this.speakingT * Math.PI * 2 * 4.2);
    const mouthOpen = this.speakingEnv * (0.2 + 0.8 * mouthPulse);
    super.setOpen(mouthOpen * 0.6);
    // Subtle head micro-nod on each speaking pulse.
    this.headGroup.rotation.x += mouthOpen * 0.04;

    // Idle arm wiggle + emotion-modulated arm amplitude.
    const armAmp = p.armAmp * (1 + this.speakingEnv * 0.4);
    this.leftShoulder.rotation.z =
      SHOULDER_REST_LZ + (Math.sin(this.t * 1.8) * 0.12 + 0.08) * armAmp;
    this.rightShoulder.rotation.z =
      SHOULDER_REST_RZ + (Math.sin(this.t * 1.8 + Math.PI) * 0.12 - 0.08) * armAmp;

    // Brows: layer emotion offsets on top of the inherited rest position.
    const setBrow = (brow: THREE.Mesh, side: number) => {
      const inner = p.browInner;
      const outer = p.browOuter;
      const yOff = (inner + outer) * 0.5;
      brow.position.y = StagePuppet.BROW_BASE_Y + yOff;
      brow.rotation.z = -side * 0.18 + p.browAngle * side;
    };
    setBrow(this.leftBrow, -1);
    setBrow(this.rightBrow, 1);

    // Layer active gesture on top of everything.
    if (this.gesture !== "none") {
      const spec = GESTURES[this.gesture];
      if (spec) {
        this.gestureT += dt;
        if (this.gestureT >= spec.duration) {
          this.gesture = "none";
        } else {
          spec.apply(this.gestureT, {
            leftShoulder: this.leftShoulder,
            rightShoulder: this.rightShoulder,
            root: this.root,
            headGroup: this.headGroup,
          });
        }
      }
    }

    // Eye glance: shift pupils within each eye toward the gaze direction.
    const pupilShiftX = gx * 0.04;
    const pupilShiftY = gy * 0.04;
    this.leftPupil.position.x = pupilShiftX;
    this.leftPupil.position.y = pupilShiftY;
    this.rightPupil.position.x = pupilShiftX;
    this.rightPupil.position.y = pupilShiftY;

    // Blink + emotion-driven eye scale. We override Puppet's blink loop
    // because we want to factor in blinkRate (emotion-modulated) and the
    // emotion eyeScaleY.
    const blinkRate = Math.max(0.05, p.blinkRate);
    this.nextBlink -= dt * blinkRate;
    let blinkScale = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const b = this.blinkT / 0.14;
      const s = b < 0.5 ? 1 - b * 2 : (b - 0.5) * 2;
      blinkScale = Math.max(0.05, s);
      if (b >= 1) {
        this.blinkT = -1;
        blinkScale = 1;
      }
    } else if (this.nextBlink <= 0 && this.blinkSuppress <= 0) {
      this.blinkT = 0;
      this.nextBlink = 2 + Math.random() * 3.5;
    }
    const finalEyeY = p.eyeScaleY * blinkScale;
    this.leftEyeMesh.scale.y = finalEyeY;
    this.rightEyeMesh.scale.y = finalEyeY;
    this.leftPupil.scale.y = finalEyeY;
    this.rightPupil.scale.y = finalEyeY;

    // Skip super.update(dt) — its blink loop would fight ours.
  }
}
