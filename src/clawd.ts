import * as THREE from "three";

const CLAWD_ORANGE = 0xd67553;
const CLAWD_DARK = 0x111111;

/**
 * Clawd — the Claude Code mascot. Blocky pixel-art creature that takes
 * over the opposite puppet slot when only one hand is on stage. Idle
 * animation: gentle bob, a little arm wiggle, occasional eye blinks,
 * and a horizontal glance toward the player.
 */
export class Clawd {
  readonly root = new THREE.Group();
  private leftEye: THREE.Mesh;
  private rightEye: THREE.Mesh;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private bodyGroup: THREE.Group;

  // Animation state.
  private t = Math.random() * 10;
  private nextBlink = 1.5 + Math.random() * 3;
  private blinkT = -1;

  constructor() {
    const orange = new THREE.MeshStandardMaterial({ color: CLAWD_ORANGE, roughness: 0.75 });
    const black = new THREE.MeshStandardMaterial({ color: CLAWD_DARK, roughness: 0.5 });

    this.bodyGroup = new THREE.Group();
    this.root.add(this.bodyGroup);

    // Main body — tall rectangular block.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.2, 1.4),
      orange,
    );
    body.position.y = 0.1;
    this.bodyGroup.add(body);

    // Eyes — small black squares set near the top-front.
    const eyeSize = 0.32;
    const makeEye = (sx: number) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(eyeSize, eyeSize, 0.2), black);
      e.position.set(sx * 0.55, 0.65, 0.71);
      this.bodyGroup.add(e);
      return e;
    };
    this.leftEye = makeEye(-1);
    this.rightEye = makeEye(1);

    // Arms — stubby horizontal blocks pivoting at the shoulder joint so
    // we can wiggle them. Each arm group pivots at the body side.
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

    // Four stubby legs spaced across the bottom.
    const legSize = 0.42;
    for (const lx of [-0.9, -0.3, 0.3, 0.9]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(legSize, 0.65, 0.9),
        orange,
      );
      leg.position.set(lx, -1.32, 0);
      this.root.add(leg);
    }
  }

  /** Advance animation by dt seconds. `glanceX` (−1..1) shifts Clawd's
   *  gaze horizontally, used to look toward the player's puppet. */
  update(dt: number, glanceX = 0) {
    this.t += dt;

    // Vertical bob.
    this.bodyGroup.position.y = Math.sin(this.t * 2.4) * 0.08;

    // Arm wiggle — small, offset between left/right.
    this.leftArm.rotation.z = Math.sin(this.t * 1.8) * 0.12 + 0.05;
    this.rightArm.rotation.z = Math.sin(this.t * 1.8 + Math.PI) * 0.12 - 0.05;

    // Gentle side-to-side body rock.
    this.bodyGroup.rotation.z = Math.sin(this.t * 1.1) * 0.04;

    // Eye glance — shift eyes slightly toward glanceX.
    const gx = Math.max(-1, Math.min(1, glanceX));
    const base = 0.55;
    const shift = gx * 0.08;
    this.leftEye.position.x = -base + shift;
    this.rightEye.position.x = base + shift;

    // Blink: briefly scale eyes flat in y.
    this.nextBlink -= dt;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const b = this.blinkT / 0.14;
      const s = b < 0.5 ? 1 - b * 2 : (b - 0.5) * 2;
      this.leftEye.scale.y = Math.max(0.05, s);
      this.rightEye.scale.y = Math.max(0.05, s);
      if (b >= 1) {
        this.blinkT = -1;
        this.leftEye.scale.y = 1;
        this.rightEye.scale.y = 1;
      }
    } else if (this.nextBlink <= 0) {
      this.blinkT = 0;
      this.nextBlink = 2 + Math.random() * 3.5;
    }
  }
}
