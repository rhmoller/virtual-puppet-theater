import * as THREE from "three";
import type { Emotion, Gesture } from "../server/protocol.ts";
import type { PuppetModel } from "./puppet-model";

// Palette. Deliberately non-naturalistic; see docs/specs/new-puppet.md for
// the "not this" list of Muppet-adjacent colors.
const SKIN = 0xc9b7e8; // pastel lavender
const SHIRT = 0xe0a244; // warm mustard
const HAIR = 0x128a8a; // deep teal
const EYE_WHITE = 0xf5f1e8;
const DARK = 0x1a1410; // near-black, shared by iris, brow, mouth
const NOSE = 0xb89cd4; // slightly darker lavender than skin

type EmotionParams = {
  eyeScaleY: number;
  rockSpeed: number;
  rockAmp: number;
  bodyTiltZ: number;
  bodyOffsetZ: number;
  armAmp: number;
  blinkRate: number;
  blinkSuppress: number;
  // Brow: inner-end height offset (positive = up), outer-end offset, and
  // rotation of each brow about z (positive = outer-up/inner-down).
  browInner: number;
  browOuter: number;
  browAngle: number;
  // Head tilt about z (positive = right tilt in view).
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
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  bodyGroup: THREE.Group;
  head: THREE.Group;
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
    apply(t, { rightArm }) {
      const env = envelope(t, 1.2);
      // Lift the arm up and wave the wrist.
      rightArm.rotation.z += -1.8 * env;
      rightArm.rotation.x += Math.sin(t * Math.PI * 2 * 2.5) * 0.6 * env;
    },
  },
  shrug: {
    duration: 0.8,
    apply(t, { leftArm, rightArm, bodyGroup }) {
      const env = envelope(t, 0.8);
      leftArm.position.y += 0.25 * env;
      rightArm.position.y += 0.25 * env;
      leftArm.rotation.z += -0.5 * env;
      rightArm.rotation.z += 0.5 * env;
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
    apply(t, { head }) {
      const env = envelope(t, 0.8);
      head.rotation.x += Math.sin(t * Math.PI * 2 * 2.5) * 0.25 * env;
    },
  },
  shake: {
    duration: 0.7,
    apply(t, { head }) {
      const env = envelope(t, 0.7);
      head.rotation.y += Math.sin(t * Math.PI * 2 * 4.3) * 0.3 * env;
    },
  },
};

/**
 * Stylized colorful human stage puppet. Drop-in replacement for Clawd;
 * same public interface. Emotions are persistent biases blended into idle
 * animation, gestures are one-shots layered on top, speaking drives a
 * mouth pulse and a subtle head micro-nod.
 */
// Native rig size matched roughly to Clawd so callers (main.ts, showcase)
// can use the same positioning without changes.
const RIG_SCALE = 0.62;

export class StagePuppet implements PuppetModel {
  readonly root = new THREE.Group();

  private rig: THREE.Group;
  private bodyGroup: THREE.Group;
  private head: THREE.Group;
  private leftEye: THREE.Mesh;
  private rightEye: THREE.Mesh;
  private leftPupil: THREE.Mesh;
  private rightPupil: THREE.Mesh;
  private leftBrow: THREE.Mesh;
  private rightBrow: THREE.Mesh;
  private mouth: THREE.Mesh;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;

  private readonly leftArmHome: THREE.Vector3;
  private readonly rightArmHome: THREE.Vector3;
  private readonly browBaseY: number;

  private t = Math.random() * 10;
  private nextBlink = 1.5 + Math.random() * 3;
  private blinkT = -1;
  private blinkSuppress = 0;

  private emotion: Emotion = "neutral";
  private params: EmotionParams = { ...EMOTIONS.neutral };
  private targetParams: EmotionParams = { ...EMOTIONS.neutral };

  private gesture: Gesture = "none";
  private gestureT = 0;

  private speaking = false;
  private speakingEnv = 0;
  private speakingT = 0;

  // Glance bias supplied via setGaze and consumed by update().
  private glanceX = 0;
  private glanceY = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.85 });
    const shirt = new THREE.MeshStandardMaterial({ color: SHIRT, roughness: 0.9 });
    const hair = new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.8 });
    const eyeWhite = new THREE.MeshStandardMaterial({ color: EYE_WHITE, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.5 });
    const nose = new THREE.MeshStandardMaterial({ color: NOSE, roughness: 0.85 });

    // rig wraps bodyGroup so the native geometry can be scaled once to
    // match Clawd's native size, independent of root.scale which is set by
    // the caller each frame.
    this.rig = new THREE.Group();
    this.rig.scale.setScalar(RIG_SCALE);
    this.root.add(this.rig);

    this.bodyGroup = new THREE.Group();
    this.rig.add(this.bodyGroup);

    // Torso — narrow shirt so shoulders sit clearly outside the body line.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.2, 8, 16), shirt);
    torso.position.y = -0.7;
    this.bodyGroup.add(torso);

    // Shoulder yoke — wider than the torso, narrower than the head. Gives a
    // clear collar/shoulder line that reads as human.
    const yoke = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.5, 6, 10), shirt);
    yoke.rotation.z = Math.PI / 2;
    yoke.position.y = -0.15;
    this.bodyGroup.add(yoke);

    // Neck — short cylinder between the yoke and the head.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.35, 16), skin);
    neck.position.y = 0.2;
    this.bodyGroup.add(neck);

    // Head group — all face features so head rotations move them together.
    this.head = new THREE.Group();
    this.head.position.y = 1.1;
    this.bodyGroup.add(this.head);

    // Skull — slightly taller than wide so the face reads human, not ball.
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1.05, 28, 22), skin);
    skull.scale.set(1.0, 1.08, 0.95);
    this.head.add(skull);

    // Chin hint — small squashed sphere below the main skull to give the
    // head a jaw shape without a second silhouette.
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 14), skin);
    chin.position.set(0, -0.55, 0.2);
    chin.scale.set(1.0, 0.7, 0.85);
    this.head.add(chin);

    // Hair — a dome covering the top third of the head. Hairline sits
    // above the brows so the forehead is visible lavender skin.
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2.3),
      hair,
    );
    hairCap.position.y = 0.1;
    hairCap.scale.set(1.02, 0.95, 1.0);
    this.head.add(hairCap);

    // Bangs — small forward fringe tucked under the front of the cap,
    // adding a hint of hair over the forehead without covering the brows.
    const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 10), hair);
    bangs.scale.set(1.02, 0.22, 0.55);
    bangs.position.set(0, 0.78, 0.58);
    this.head.add(bangs);

    // Ears — small squashed spheres on each side, under the hair line.
    const earGeom = new THREE.SphereGeometry(0.22, 14, 12);
    const leftEar = new THREE.Mesh(earGeom, skin);
    leftEar.position.set(-1.02, -0.05, 0.05);
    leftEar.scale.set(0.5, 1.2, 0.85);
    this.head.add(leftEar);
    const rightEar = new THREE.Mesh(earGeom, skin);
    rightEar.position.set(1.02, -0.05, 0.05);
    rightEar.scale.set(0.5, 1.2, 0.85);
    this.head.add(rightEar);

    // Eyes — white spheres with iris spheres sitting slightly forward so
    // they read as pupils when the camera sees them.
    const makeEye = (sx: number) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), eyeWhite);
      eye.position.set(sx * 0.4, 0.12, 0.78);
      this.head.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), dark);
      pupil.position.set(sx * 0.4, 0.12, 1.02);
      this.head.add(pupil);
      return { eye, pupil };
    };
    const l = makeEye(-1);
    const r = makeEye(1);
    this.leftEye = l.eye;
    this.rightEye = r.eye;
    this.leftPupil = l.pupil;
    this.rightPupil = r.pupil;

    // Brows — thin boxes above each eye. Box pivot is at its center; we
    // offset by rotating the mesh inside a group so rotation happens about
    // the inner end (for inner-up/outer-down type expressions).
    this.browBaseY = 0.5;
    const makeBrow = (sx: number) => {
      const g = new THREE.Group();
      g.position.set(sx * 0.42, this.browBaseY, 0.9);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.08), dark);
      g.add(mesh);
      this.head.add(g);
      return mesh;
    };
    this.leftBrow = makeBrow(-1);
    this.rightBrow = makeBrow(1);

    // Nose — small sphere between eyes and mouth, pushed forward so it
    // clears the skull surface and reads as a distinct feature.
    const noseMesh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), nose);
    noseMesh.position.set(0, -0.1, 1.05);
    noseMesh.scale.set(1, 1.1, 1.2);
    this.head.add(noseMesh);

    // Mouth — a dark flattened ellipse. Hidden at rest; Y-scale opens it
    // when speaking, matching Clawd's mouth behavior.
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 12), dark);
    this.mouth.scale.set(1.5, 0.5, 0.5);
    this.mouth.position.set(0, -0.42, 0.88);
    this.mouth.visible = false;
    this.head.add(this.mouth);

    // Arms — groups pivoted at the shoulder outside the torso. Each arm
    // tilts slightly outward so the hand clears the body.
    this.leftArmHome = new THREE.Vector3(-0.95, -0.15, 0);
    this.rightArmHome = new THREE.Vector3(0.95, -0.15, 0);
    const makeArm = (sx: number, home: THREE.Vector3) => {
      const group = new THREE.Group();
      group.position.copy(home);
      // Upper arm hangs down-and-slightly-out so hands clear the body.
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.0, 8, 14), shirt);
      upper.position.set(sx * 0.12, -0.6, 0);
      upper.rotation.z = -sx * 0.14;
      group.add(upper);
      // Hand — sphere at the end of the arm.
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 14), skin);
      hand.position.set(sx * 0.28, -1.15, 0);
      hand.scale.set(1, 0.9, 0.8);
      group.add(hand);
      this.bodyGroup.add(group);
      return group;
    };
    this.leftArm = makeArm(-1, this.leftArmHome);
    this.rightArm = makeArm(1, this.rightArmHome);
  }

  // Mouth is TTS-driven via setSpeaking; setOpen is a no-op here so the
  // unified PuppetModel interface stays uniform across rigs.
  setOpen(_amount: number) {}

  setRoll(rad: number) {
    this.root.rotation.z = rad;
  }

  setGaze(gx: number, gy: number) {
    // Persist a glance bias used by the next update() tick. StagePuppet's
    // existing update(dt, glanceX, glanceY) signature already does the
    // work — this just stores the values for the next frame.
    this.glanceX = gx;
    this.glanceY = gy;
  }

  setEmotion(e: Emotion) {
    if (e === this.emotion) return;
    this.emotion = e;
    this.targetParams = EMOTIONS[e];
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

  update(dt: number) {
    const glanceX = this.glanceX;
    const glanceY = this.glanceY;
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
    p.browInner += (tgt.browInner - p.browInner) * k;
    p.browOuter += (tgt.browOuter - p.browOuter) * k;
    p.browAngle += (tgt.browAngle - p.browAngle) * k;
    p.headTiltZ += (tgt.headTiltZ - p.headTiltZ) * k;

    // Reset transforms so gesture offsets don't accumulate frame-over-frame.
    this.bodyGroup.position.set(0, 0, 0);
    this.bodyGroup.rotation.set(0, 0, 0);
    this.bodyGroup.scale.setScalar(1);
    this.head.position.set(0, 1.0, 0);
    this.head.rotation.set(0, 0, 0);
    this.leftArm.position.copy(this.leftArmHome);
    this.rightArm.position.copy(this.rightArmHome);
    this.leftArm.rotation.set(0, 0, 0);
    this.rightArm.rotation.set(0, 0, 0);

    // Idle body bob and sway.
    this.bodyGroup.position.y = Math.sin(this.t * 2.4) * 0.08;
    this.bodyGroup.position.z = p.bodyOffsetZ;
    this.bodyGroup.rotation.z =
      Math.sin(this.t * 1.1 * p.rockSpeed) * 0.04 * p.rockAmp + p.bodyTiltZ;

    // Emotion head tilt + vertical gaze head tilt. Up (+gy) tilts the head
    // back (negative rotation.x so the face lifts); down does the opposite.
    this.head.rotation.z = p.headTiltZ;
    const gy = Math.max(-1, Math.min(1, glanceY));
    this.head.rotation.x = -gy * 0.18;

    // Speaking envelope.
    this.speakingT += dt;
    this.speakingEnv += ((this.speaking ? 1 : 0) - this.speakingEnv) * (1 - Math.exp(-dt / 0.09));

    // Idle arm wiggle + speaking boost.
    const armAmp = p.armAmp * (1 + this.speakingEnv * 0.4);
    this.leftArm.rotation.z = (Math.sin(this.t * 1.8) * 0.12 + 0.08) * armAmp;
    this.rightArm.rotation.z = (Math.sin(this.t * 1.8 + Math.PI) * 0.12 - 0.08) * armAmp;

    // Mouth pulse (when speaking) + subtle head micro-nod. Mouth is hidden
    // when not speaking; Y-scale pulses between a thin line and the full
    // ellipse while the envelope is open.
    const mouthPulse = 0.5 + 0.5 * Math.sin(this.speakingT * Math.PI * 2 * 4.2);
    const mouthOpen = this.speakingEnv * (0.2 + 0.8 * mouthPulse);
    this.head.rotation.x += mouthOpen * 0.04;
    this.mouth.scale.y = 0.5 * mouthOpen;
    this.mouth.visible = mouthOpen > 0.02;

    // Brows: reset, then apply emotion offsets + angles.
    const setBrow = (brow: THREE.Mesh, side: number) => {
      // Inner end is at side=+1 for left brow (sx=-1), side=-1 for right.
      // Simpler: the group position carries the horizontal offset; height
      // offset mixes inner/outer based on side sign of the brow.
      const inner = p.browInner;
      const outer = p.browOuter;
      // Average height for vertical lift.
      const yOff = (inner + outer) * 0.5;
      brow.position.y = yOff;
      // Rotate: side=-1 is the left brow, positive rotation raises its
      // outer (left) end; side=+1 is the right, needs opposite sign for the
      // same visual "inner-down outer-up" effect.
      brow.rotation.z = p.browAngle * side;
    };
    setBrow(this.leftBrow, -1);
    setBrow(this.rightBrow, 1);

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
            head: this.head,
          });
        }
      }
    }

    // Eye glance — shift pupils toward (glanceX, glanceY) within each eye.
    const gx = Math.max(-1, Math.min(1, glanceX));
    const pupilShiftX = gx * 0.08;
    const pupilShiftY = gy * 0.07;
    this.leftPupil.position.x = -0.4 + pupilShiftX;
    this.rightPupil.position.x = 0.4 + pupilShiftX;
    this.leftPupil.position.y = 0.12 + pupilShiftY;
    this.rightPupil.position.y = 0.12 + pupilShiftY;

    // Blink.
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
    this.leftPupil.scale.y = finalEyeY;
    this.rightPupil.scale.y = finalEyeY;
  }
}
