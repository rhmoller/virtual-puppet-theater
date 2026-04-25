import * as THREE from "three";
import type { Emotion, Gesture } from "../server/protocol.ts";

const CLAWD_ORANGE = 0xd67553;
const CLAWD_DARK = 0x111111;

type EmotionParams = {
  eyeScaleY: number;
  rockSpeed: number;
  rockAmp: number;
  bodyTiltZ: number;
  bodyOffsetZ: number;
  armAmp: number;
  blinkRate: number;
  blinkSuppress: number;
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
  },
  smug: {
    eyeScaleY: 0.55,
    rockSpeed: 0.7,
    rockAmp: 0.9,
    bodyTiltZ: 0.08,
    bodyOffsetZ: 0.0,
    armAmp: 0.8,
    blinkRate: 0.6,
    blinkSuppress: 0,
  },
  curious: {
    eyeScaleY: 1.1,
    rockSpeed: 0.9,
    rockAmp: 0.6,
    bodyTiltZ: 0.15,
    bodyOffsetZ: 0.0,
    armAmp: 0.7,
    blinkRate: 1.4,
    blinkSuppress: 0,
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
  },
  bored: {
    eyeScaleY: 0.7,
    rockSpeed: 0.4,
    rockAmp: 0.5,
    bodyTiltZ: -0.05,
    bodyOffsetZ: 0.0,
    armAmp: 0.4,
    blinkRate: 0.3,
    blinkSuppress: 0,
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
  },
};

type GestureSpec = {
  duration: number;
  apply: (t: number, rig: GestureRig) => void;
};

type GestureRig = {
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  bodyGroup: THREE.Group;
};

// Triangular fade envelope (0→1→0) over the first and last 20% of the clip.
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
    apply(t, { rightArm }) {
      const env = envelope(t, 1.2);
      rightArm.rotation.z += Math.sin(t * Math.PI * 2 * 2.5) * 1.0 * env;
    },
  },
  shrug: {
    duration: 0.8,
    apply(t, { leftArm, rightArm, bodyGroup }) {
      const env = envelope(t, 0.8);
      leftArm.rotation.z += -0.9 * env;
      rightArm.rotation.z += 0.9 * env;
      bodyGroup.position.y -= 0.05 * env;
    },
  },
  lean_in: {
    duration: 1.0,
    apply(t, { bodyGroup }) {
      const env = envelope(t, 1.0);
      bodyGroup.position.z += 0.35 * env;
      bodyGroup.scale.setScalar(1 + 0.05 * env);
    },
  },
  nod: {
    duration: 0.8,
    apply(t, { bodyGroup }) {
      const env = envelope(t, 0.8);
      bodyGroup.rotation.x += Math.sin(t * Math.PI * 2 * 2.5) * 0.2 * env;
    },
  },
  shake: {
    duration: 0.7,
    apply(t, { bodyGroup }) {
      const env = envelope(t, 0.7);
      bodyGroup.rotation.y += Math.sin(t * Math.PI * 2 * 4.3) * 0.25 * env;
    },
  },
  // Clawd is the legacy puppet (no longer on stage). The new
  // jump/spin/wiggle gestures aren't authored for him; treat them as
  // no-ops so the type satisfies Record<Gesture, ...>.
  jump: null,
  spin: null,
  wiggle: null,
};

/**
 * Clawd — the Claude Code mascot. Expressions (emotion) are persistent
 * biases blended into the idle animation; gestures are one-shot clips
 * layered on top.
 */
export class Clawd {
  readonly root = new THREE.Group();
  private leftEye: THREE.Mesh;
  private rightEye: THREE.Mesh;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private bodyGroup: THREE.Group;
  private mouth: THREE.Mesh;

  private t = Math.random() * 10;
  private nextBlink = 1.5 + Math.random() * 3;
  private blinkT = -1;
  private blinkSuppress = 0;

  // Emotion state: current blended params + target params. On setEmotion,
  // target is swapped and current eases toward it over EMOTION_BLEND_TAU.
  private emotion: Emotion = "neutral";
  private params: EmotionParams = { ...EMOTIONS.neutral };
  private targetParams: EmotionParams = { ...EMOTIONS.neutral };

  // One-shot gesture state.
  private gesture: Gesture = "none";
  private gestureT = 0;

  // Speaking state: `speaking` toggles externally (via setSpeaking), `env`
  // eases toward it so the mouth opens/closes smoothly on either end, and
  // `speakingT` drives the open/close pulse.
  private speaking = false;
  private speakingEnv = 0;
  private speakingT = 0;

  constructor() {
    const orange = new THREE.MeshStandardMaterial({ color: CLAWD_ORANGE, roughness: 0.75 });
    const black = new THREE.MeshStandardMaterial({ color: CLAWD_DARK, roughness: 0.5 });

    this.bodyGroup = new THREE.Group();
    this.root.add(this.bodyGroup);

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 1.4), orange);
    body.position.y = 0.1;
    this.bodyGroup.add(body);

    const eyeSize = 0.32;
    const makeEye = (sx: number) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(eyeSize, eyeSize, 0.2), black);
      e.position.set(sx * 0.55, 0.65, 0.71);
      this.bodyGroup.add(e);
      return e;
    };
    this.leftEye = makeEye(-1);
    this.rightEye = makeEye(1);

    // Mouth: a wide black rectangle, only visible while Clawd is
    // speaking. Scale on Y animates open/close; hidden entirely at rest.
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.14), black);
    this.mouth.position.set(0, -0.1, 0.71);
    this.mouth.visible = false;
    this.bodyGroup.add(this.mouth);

    const makeArm = (sx: number) => {
      const group = new THREE.Group();
      group.position.set(sx * 1.2, 0, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.9), orange);
      arm.position.set(sx * 0.45, 0, 0);
      group.add(arm);
      this.root.add(group);
      return group;
    };
    this.leftArm = makeArm(-1);
    this.rightArm = makeArm(1);

    const legSize = 0.42;
    for (const lx of [-0.9, -0.3, 0.3, 0.9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(legSize, 0.65, 0.9), orange);
      leg.position.set(lx, -1.32, 0);
      this.root.add(leg);
    }
  }

  setEmotion(e: Emotion) {
    if (e === this.emotion) return;
    this.emotion = e;
    this.targetParams = EMOTIONS[e];
    // surprised's blink suppression is a one-shot budget, not a steady rate.
    if (EMOTIONS[e].blinkSuppress > 0) this.blinkSuppress = EMOTIONS[e].blinkSuppress;
  }

  playGesture(g: Gesture) {
    if (!GESTURES[g]) {
      this.gesture = "none";
      return;
    }
    this.gesture = g;
    this.gestureT = 0;
  }

  setSpeaking(on: boolean) {
    this.speaking = on;
  }

  /** Advance animation by dt seconds. `glanceX` (−1..1) shifts Clawd's
   *  gaze horizontally. */
  update(dt: number, glanceX = 0) {
    this.t += dt;
    this.blinkSuppress = Math.max(0, this.blinkSuppress - dt);

    // Ease current emotion params toward target over ~300 ms.
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

    // Reset bodyGroup each frame so gesture offsets don't accumulate.
    this.bodyGroup.position.set(0, 0, 0);
    this.bodyGroup.rotation.set(0, 0, 0);
    this.bodyGroup.scale.setScalar(1);

    // Idle bob + body rock (scaled by emotion).
    this.bodyGroup.position.y = Math.sin(this.t * 2.4) * 0.08;
    this.bodyGroup.position.z = p.bodyOffsetZ;
    this.bodyGroup.rotation.z =
      Math.sin(this.t * 1.1 * p.rockSpeed) * 0.04 * p.rockAmp + p.bodyTiltZ;

    // Speaking envelope eases toward speaking/not so mouth and extra
    // articulation transition without popping.
    this.speakingT += dt;
    this.speakingEnv += ((this.speaking ? 1 : 0) - this.speakingEnv) * (1 - Math.exp(-dt / 0.09));

    // Idle arm wiggle, scaled by emotion plus a speaking boost so Clawd
    // gestures a little more enthusiastically while he's talking.
    const armAmp = p.armAmp * (1 + this.speakingEnv * 0.4);
    this.leftArm.rotation.z = (Math.sin(this.t * 1.8) * 0.12 + 0.05) * armAmp;
    this.rightArm.rotation.z = (Math.sin(this.t * 1.8 + Math.PI) * 0.12 - 0.05) * armAmp;

    // Subtle head nod locked to the mouth pulse (extra speaking articulation).
    const mouthPulse = 0.5 + 0.5 * Math.sin(this.speakingT * Math.PI * 2 * 4.2);
    const mouthOpen = this.speakingEnv * mouthPulse;
    this.bodyGroup.rotation.x += mouthOpen * 0.03;
    // Mouth is hidden when not speaking; fades in/out via speakingEnv and
    // pulses while speaking, from a thin-line base up to the full box.
    const mouthScale = this.speakingEnv * (0.2 + 0.8 * mouthPulse);
    this.mouth.scale.y = mouthScale;
    this.mouth.visible = mouthScale > 0.01;

    // Layer active gesture on top.
    if (this.gesture !== "none") {
      const spec = GESTURES[this.gesture];
      if (spec) {
        this.gestureT += dt;
        if (this.gestureT >= spec.duration) {
          this.gesture = "none";
        } else {
          spec.apply(this.gestureT, {
            leftArm: this.leftArm,
            rightArm: this.rightArm,
            bodyGroup: this.bodyGroup,
          });
        }
      }
    }

    // Eye glance — shift eyes slightly toward glanceX.
    const gx = Math.max(-1, Math.min(1, glanceX));
    const base = 0.55;
    const shift = gx * 0.08;
    this.leftEye.position.x = -base + shift;
    this.rightEye.position.x = base + shift;

    // Blink: brief flat-scale on Y, layered on top of the emotion's eyeScaleY.
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
    this.leftEye.scale.y = finalEyeY;
    this.rightEye.scale.y = finalEyeY;
  }
}
