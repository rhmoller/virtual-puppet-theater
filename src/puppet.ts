import * as THREE from "three";

export type PuppetTheme = {
  skin: number;
  shirt: number;
  hair: number;
};

// Two stock themes used by main.ts. Kept inline so the user puppet has
// a clear visual identity without a separate roster module.
export const PUPPET_THEMES = {
  warm: { skin: 0xf2c0a8, shirt: 0xd98b4f, hair: 0x4a3a2e },
  cool: { skin: 0xc9d6c3, shirt: 0x7fb3a0, hair: 0x2a3a4a },
} as const satisfies Record<string, PuppetTheme>;

// Joint dimensions. Must stay in sync with src/ragdoll.ts.
const TORSO_R = 0.55;
const TORSO_LEN = 1.4;
const UPPER_R = 0.18;
const UPPER_LEN = 0.8;
const LOWER_R = 0.15;
const LOWER_LEN = 0.75;

const BROW_DARK = 0x1a1410;
const EYE_WHITE = 0xf5f1e8;
const MOUTH_INTERIOR = 0x3a0a14;
const TONGUE = 0xcc5566;

/**
 * Hand-puppet rig driven by MediaPipe landmarks. The head is a sphere
 * split into upper/lower jaw — opening the lower jaw is the main visual
 * feature, since the user controls it directly with their hand. Limb
 * groups (torso/shoulders/elbows) are pivot anchors for the Verlet
 * Ragdoll in src/ragdoll.ts; their dimensions must match the constants
 * mirrored there.
 */
export class Puppet {
  readonly root = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly leftShoulder = new THREE.Group();
  readonly rightShoulder = new THREE.Group();
  readonly leftElbow = new THREE.Group();
  readonly rightElbow = new THREE.Group();

  private headGroup = new THREE.Group();
  private upperJaw = new THREE.Group();
  private lowerJaw = new THREE.Group();
  private leftEye = new THREE.Group();
  private rightEye = new THREE.Group();

  private leftEyeMesh: THREE.Mesh;
  private rightEyeMesh: THREE.Mesh;
  private leftPupil: THREE.Mesh;
  private rightPupil: THREE.Mesh;
  private blinkT = -1;
  private nextBlink = 1.5 + Math.random() * 3;

  constructor(theme: PuppetTheme) {
    const skin = new THREE.MeshStandardMaterial({ color: theme.skin, roughness: 0.85 });
    const shirt = new THREE.MeshStandardMaterial({ color: theme.shirt, roughness: 0.9 });
    const hair = new THREE.MeshStandardMaterial({ color: theme.hair, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: BROW_DARK, roughness: 0.5 });
    const eyeWhite = new THREE.MeshStandardMaterial({ color: EYE_WHITE, roughness: 0.4 });

    // Mouth interior — a dark sphere inside the head, revealed when the
    // jaw opens. The split half-sphere jaws cover it at rest.
    const interior = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 24, 16),
      new THREE.MeshStandardMaterial({ color: MOUTH_INTERIOR, roughness: 0.7 }),
    );
    this.root.add(interior);

    // ---- Upper jaw: forehead, eyes, brows, hair, nose ----
    const upper = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      skin,
    );
    this.upperJaw.add(upper);

    // Hair cap — covers the top third of the skull. Slightly oversized so
    // the hairline reads cleanly above the brows.
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(1.04, 40, 18, 0, Math.PI * 2, 0, Math.PI / 3),
      hair,
    );
    hairCap.position.y = 0.02;
    this.upperJaw.add(hairCap);

    // Forward bangs — a small fringe under the front of the cap so the
    // hairline isn't a clean shaved edge.
    const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.85, 22, 10), hair);
    bangs.scale.set(1.0, 0.18, 0.55);
    bangs.position.set(0, 0.7, 0.62);
    this.upperJaw.add(bangs);

    for (const [side, eyeGroup] of [
      [-1, this.leftEye],
      [+1, this.rightEye],
    ] as const) {
      eyeGroup.position.set(side * 0.4, 0.45, 0.78);
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.22, 22, 18), eyeWhite);
      eyeGroup.add(w);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), dark);
      pupil.position.set(0, 0, 0.16);
      eyeGroup.add(pupil);
      this.upperJaw.add(eyeGroup);

      // Brow above the eye, angled slightly outward — gives a friendlier
      // expression than a flat bar.
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.08), dark);
      brow.position.set(side * 0.42, 0.74, 0.84);
      brow.rotation.z = side * -0.18;
      this.upperJaw.add(brow);
    }

    // Nose — a small skin-colored sphere just above the mouth line.
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), skin);
    nose.position.set(0, 0.12, 0.97);
    nose.scale.set(1, 1.05, 1.25);
    this.upperJaw.add(nose);

    // ---- Lower jaw: chin + tongue inside ----
    const lower = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      skin,
    );
    this.lowerJaw.add(lower);

    // Tongue — thin pink slab inside the lower jaw, visible when open.
    const tongue = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 18, 12),
      new THREE.MeshStandardMaterial({ color: TONGUE, roughness: 0.7 }),
    );
    tongue.scale.set(1, 0.18, 0.95);
    tongue.position.set(0, -0.32, 0.05);
    this.lowerJaw.add(tongue);

    this.headGroup.add(this.upperJaw);
    this.headGroup.add(this.lowerJaw);
    this.root.add(this.headGroup);

    // ---- Torso: shirt + collar ----
    const torsoMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(TORSO_R, TORSO_LEN, 6, 16),
      shirt,
    );
    torsoMesh.position.y = -(TORSO_LEN / 2 + TORSO_R);
    this.torso.add(torsoMesh);

    // Collar — torus ring at the neck line.
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(TORSO_R * 0.92, 0.07, 8, 24),
      new THREE.MeshStandardMaterial({ color: theme.shirt, roughness: 0.7, metalness: 0.05 }),
    );
    collar.position.y = -0.05;
    collar.rotation.x = Math.PI / 2;
    this.torso.add(collar);

    this.torso.position.set(0, -1, 0);
    this.root.add(this.torso);

    // ---- Arms: shirt sleeve + cuff + bare forearm + hand ----
    const buildArm = (shoulder: THREE.Group, elbow: THREE.Group, sx: number) => {
      shoulder.position.set(sx * 0.55, -1.15, 0);

      const upperArm = new THREE.Mesh(
        new THREE.CapsuleGeometry(UPPER_R, UPPER_LEN, 6, 12),
        shirt,
      );
      upperArm.position.y = -(UPPER_LEN / 2 + UPPER_R);
      shoulder.add(upperArm);

      // Cuff — dark band where the sleeve ends.
      const cuff = new THREE.Mesh(
        new THREE.CylinderGeometry(UPPER_R * 1.1, UPPER_R * 1.1, 0.06, 14),
        new THREE.MeshStandardMaterial({ color: theme.hair, roughness: 0.7 }),
      );
      cuff.position.y = -(UPPER_LEN + UPPER_R * 1.6);
      shoulder.add(cuff);

      elbow.position.y = -(UPPER_LEN + UPPER_R * 2);
      shoulder.add(elbow);

      const lowerArm = new THREE.Mesh(
        new THREE.CapsuleGeometry(LOWER_R, LOWER_LEN, 6, 12),
        skin,
      );
      lowerArm.position.y = -(LOWER_LEN / 2 + LOWER_R);
      elbow.add(lowerArm);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skin);
      hand.position.y = -(LOWER_LEN + LOWER_R * 2);
      elbow.add(hand);

      shoulder.rotation.z = sx * 0.15;
    };
    buildArm(this.leftShoulder, this.leftElbow, -1);
    buildArm(this.rightShoulder, this.rightElbow, 1);
    this.root.add(this.leftShoulder);
    this.root.add(this.rightShoulder);

    this.leftEyeMesh = this.leftEye.children[0] as THREE.Mesh;
    this.rightEyeMesh = this.rightEye.children[0] as THREE.Mesh;
    this.leftPupil = this.leftEye.children[1] as THREE.Mesh;
    this.rightPupil = this.rightEye.children[1] as THREE.Mesh;
  }

  setOpen(amount: number) {
    const a = Math.max(0, Math.min(1, amount));
    this.lowerJaw.rotation.x = a * 0.9;
    this.upperJaw.rotation.x = -a * 0.25;
  }

  setGaze(gx: number, gy: number) {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.headGroup.rotation.y = clamp(gx) * 0.5;
    this.headGroup.rotation.x = -clamp(gy) * 0.35;
    for (const eye of [this.leftEye, this.rightEye]) {
      eye.rotation.y = clamp(gx) * 0.25;
      eye.rotation.x = -clamp(gy) * 0.18;
    }
  }

  // Idle blink. Called per-frame while the puppet is visible.
  update(dt: number) {
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const b = this.blinkT / 0.14;
      const s = b < 0.5 ? 1 - b * 2 : (b - 0.5) * 2;
      const k = Math.max(0.05, s);
      this.leftEyeMesh.scale.y = k;
      this.rightEyeMesh.scale.y = k;
      this.leftPupil.scale.y = k;
      this.rightPupil.scale.y = k;
      if (b >= 1) {
        this.blinkT = -1;
        this.leftEyeMesh.scale.y = 1;
        this.rightEyeMesh.scale.y = 1;
        this.leftPupil.scale.y = 1;
        this.rightPupil.scale.y = 1;
      }
    } else {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.blinkT = 0;
        this.nextBlink = 2 + Math.random() * 3.5;
      }
    }
  }
}
