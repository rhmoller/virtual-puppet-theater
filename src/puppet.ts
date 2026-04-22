import * as THREE from "three";

export class Puppet {
  readonly root = new THREE.Group();
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
