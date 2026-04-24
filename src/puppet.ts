import * as THREE from "three";

/**
 * Each limb segment is a Group whose pivot sits at its top joint and whose
 * mesh extends downward along local -Y. Rag-doll physics can drive these
 * groups' rotations without worrying about child offsets.
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

  constructor(color: number) {
    const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff });

    const interior = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x3a0a14 }),
    );
    this.root.add(interior);

    const upperMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      skin,
    );
    this.upperJaw.add(upperMesh);

    for (const [side, eye] of [
      [-1, this.leftEye],
      [+1, this.rightEye],
    ] as const) {
      eye.position.set(side * 0.38, 0.55, 0.72);
      const whiteMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), white);
      eye.add(whiteMesh);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), dark);
      pupil.position.set(0, 0, 0.14);
      eye.add(pupil);
      this.upperJaw.add(eye);
    }

    const lowerMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      skin,
    );
    this.lowerJaw.add(lowerMesh);

    this.headGroup.add(this.upperJaw);
    this.headGroup.add(this.lowerJaw);
    this.root.add(this.headGroup);

    // Torso: capsule hanging from the neck joint at y = -1 (head bottom).
    const torsoLen = 1.4;
    const torsoR = 0.55;
    const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(torsoR, torsoLen, 6, 16), skin);
    torsoMesh.position.y = -(torsoLen / 2 + torsoR);
    this.torso.add(torsoMesh);
    this.torso.position.set(0, -1, 0);
    this.root.add(this.torso);

    // Arms: shoulder → upper arm → elbow → lower arm → hand. Each joint
    // group's pivot is at the top of its segment.
    const upperLen = 0.8;
    const upperR = 0.18;
    const lowerLen = 0.75;
    const lowerR = 0.15;

    const buildArm = (shoulder: THREE.Group, elbow: THREE.Group, sx: number) => {
      shoulder.position.set(sx * 0.55, -1.15, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperR, upperLen, 6, 12), skin);
      upper.position.y = -(upperLen / 2 + upperR);
      shoulder.add(upper);

      elbow.position.y = -(upperLen + upperR * 2);
      shoulder.add(elbow);

      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerR, lowerLen, 6, 12), skin);
      lower.position.y = -(lowerLen / 2 + lowerR);
      elbow.add(lower);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skin);
      hand.position.y = -(lowerLen + lowerR * 2);
      elbow.add(hand);

      // Rest pose: arms drop slightly outward and forward.
      shoulder.rotation.z = sx * 0.15;
    };
    buildArm(this.leftShoulder, this.leftElbow, -1);
    buildArm(this.rightShoulder, this.rightElbow, 1);
    this.root.add(this.leftShoulder);
    this.root.add(this.rightShoulder);
  }

  setOpen(amount: number) {
    const a = Math.max(0, Math.min(1, amount));
    this.lowerJaw.rotation.x = a * 0.9;
    this.upperJaw.rotation.x = -a * 0.25;
  }

  setGaze(gx: number, gy: number) {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    // Head does the gross rotation; pupils do fine-tuning within
    this.headGroup.rotation.y = clamp(gx) * 0.5;
    this.headGroup.rotation.x = -clamp(gy) * 0.35;
    for (const eye of [this.leftEye, this.rightEye]) {
      eye.rotation.y = clamp(gx) * 0.25;
      eye.rotation.x = -clamp(gy) * 0.18;
    }
  }
}
