import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const GOLD = 0xc9a064;
const GOLD_HI = 0xe3c080;
const GOLD_LO = 0x8a6d3a;
const RED = 0x8a1010;
const RED_HI = 0xb02020;
const RED_LO = 0x4a0808;
const WOOD = 0x5a2a18;
const WOOD_DARK = 0x2e1408;
const BACKDROP = 0x120505;

// Named regions where Claude can place scene props. Coordinates are
// in world space (the theater root sits at the origin). Sized so sky
// items read as far away and ground items as up-close, while still
// fitting inside the proscenium frame.
const ANCHOR_POSITIONS: Record<string, [number, number, number]> = {
  sky_left: [-3, 2.0, -3],
  sky_center: [0, 2.5, -3],
  sky_right: [3, 2.0, -3],
  ground_left: [-2.8, -1.5, -1.5],
  ground_center: [0, -1.7, -1.5],
  ground_right: [2.8, -1.5, -1.5],
  far_back: [0, 0, -3.5],
};

export class Theater {
  readonly root = new THREE.Group();
  private group = new THREE.Group();
  // Anchor groups for scene props. Not inside `this.group` because
  // `layout()` calls `this.group.clear()` on resize, which would
  // wipe any mounted props. Anchors live directly on `this.root`.
  private anchors: Record<string, THREE.Group> = {};

  private mGold = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.5 });
  private mGoldHi = new THREE.MeshStandardMaterial({
    color: GOLD_HI,
    roughness: 0.25,
    metalness: 0.6,
  });
  private mGoldLo = new THREE.MeshStandardMaterial({
    color: GOLD_LO,
    roughness: 0.55,
    metalness: 0.4,
  });
  private mRed = new THREE.MeshStandardMaterial({
    color: RED,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  private mRedHi = new THREE.MeshStandardMaterial({
    color: RED_HI,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  private mRedLo = new THREE.MeshStandardMaterial({
    color: RED_LO,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  private mWood = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.9 });
  private mWoodDark = new THREE.MeshStandardMaterial({ color: WOOD_DARK, roughness: 0.95 });
  private mBackdrop = new THREE.MeshBasicMaterial({ color: BACKDROP });

  constructor() {
    this.root.add(this.group);
    for (const [name, [x, y, z]] of Object.entries(ANCHOR_POSITIONS)) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      this.anchors[name] = g;
      this.root.add(g);
    }
  }

  /** Returns the named scene-prop anchor Group. SceneController mounts
   *  pre-fab and generated scene props inside these. */
  anchor(name: string): THREE.Group | null {
    return this.anchors[name] ?? null;
  }

  layout(w: number, h: number) {
    this.group.clear();

    // Column width and top-frame thickness scale with the viewport.
    const col = Math.min(w * 0.14, h * 0.16, 2.2);
    const topH = Math.min(h * 0.15, 1.8);
    const baseH = Math.min(h * 0.14, 1.6);
    const stageH = baseH; // apron below visible stage
    const archR = Math.min(col * 1.1, topH * 0.75);

    // Opening (inner cutout) bounds.
    const ix = w / 2 - col;
    const iyTop = h / 2 - topH;
    const iyBot = -h / 2 + baseH;
    const innerW = ix * 2;

    // Backdrop far behind everything.
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.5, h * 1.5), this.mBackdrop);
    backdrop.position.z = -4;
    this.group.add(backdrop);

    // Back wall inside the opening: dark brown so curtains read against it.
    // Extended slightly past the opening so its edges are hidden behind the
    // outer curtain edges (and the frame face at z=0.3 covers anything
    // beyond the opening cutout).
    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(innerW + Math.min(w, 4) * 0.12, iyTop - iyBot),
      this.mWoodDark,
    );
    backWall.position.set(0, (iyTop + iyBot) / 2, -2);
    this.group.add(backWall);

    // Curtains (behind frame but in front of back wall).
    this.buildValance(w, h, col, topH, iyTop, innerW);
    this.buildSideCurtains(col, topH, baseH, ix, iyTop, iyBot);

    // Proscenium frame: single gold shape with an arched inner cutout.
    this.buildFrame(w, h, col, topH, baseH, ix, iyTop, iyBot, archR);

    // Decorative panels, cartouches, finials, column ornaments.
    this.buildOrnaments(w, h, col, topH, baseH, stageH, ix, iyTop, iyBot);

    // Footlights — warm up-light; the visible bulbs would read as garish,
    // so use just a soft point light under the valance.
    const up = new THREE.PointLight(0xffb070, 0.9, w * 1.2, 2);
    up.position.set(0, iyBot + 0.4, 1.5);
    this.group.add(up);
  }

  private buildFrame(
    w: number,
    h: number,
    col: number,
    topH: number,
    baseH: number,
    ix: number,
    iyTop: number,
    iyBot: number,
    archR: number,
  ) {
    // Outer rectangle with an arched opening hole.
    const outer = new THREE.Shape();
    outer.moveTo(-w / 2, -h / 2);
    outer.lineTo(w / 2, -h / 2);
    outer.lineTo(w / 2, h / 2);
    outer.lineTo(-w / 2, h / 2);
    outer.lineTo(-w / 2, -h / 2);

    const hole = new THREE.Path();
    hole.moveTo(-ix, iyBot);
    hole.lineTo(ix, iyBot);
    hole.lineTo(ix, iyTop - archR);
    hole.quadraticCurveTo(ix, iyTop, ix - archR, iyTop);
    hole.lineTo(-ix + archR, iyTop);
    hole.quadraticCurveTo(-ix, iyTop, -ix, iyTop - archR);
    hole.lineTo(-ix, iyBot);
    outer.holes.push(hole);

    const face = new THREE.Mesh(new THREE.ShapeGeometry(outer), this.mGold);
    face.position.z = 0.3;
    this.group.add(face);

    // Dark wood inlay panels on the column faces and base apron — adds
    // the two-tone gold/wood look instead of a solid gold face.
    const panelInset = Math.min(col * 0.22, 0.5);
    const makeInlay = (cx: number, cy: number, pw: number, ph: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
      m.position.set(cx, cy, 0.35);
      this.group.add(m);
    };
    const colPanelH = iyTop - iyBot - panelInset * 2;
    const colPanelW = col - panelInset * 2;
    makeInlay(-w / 2 + col / 2, (iyTop + iyBot) / 2, colPanelW, colPanelH, this.mWood);
    makeInlay(w / 2 - col / 2, (iyTop + iyBot) / 2, colPanelW, colPanelH, this.mWood);

    // Base apron panel (below the stage opening), red with gold trim added in ornaments.
    const apronW = w - col * 2 - panelInset * 2;
    const apronH = baseH - panelInset * 2;
    makeInlay(0, -h / 2 + baseH / 2, apronW, apronH, this.mRedLo);

    // Top frieze panel — slightly darker red/brown behind the pediment scrollwork.
    const topPanelW = w - col * 2 - panelInset * 2;
    const topPanelH = topH - panelInset * 2;
    makeInlay(0, h / 2 - topH / 2, topPanelW, topPanelH, this.mWoodDark);

    // Gold bead trim following the inside edge of the arch.
    this.buildArchBead(col, topH, baseH, ix, iyTop, iyBot, archR);
  }

  private buildArchBead(
    _col: number,
    _topH: number,
    _baseH: number,
    ix: number,
    iyTop: number,
    iyBot: number,
    archR: number,
  ) {
    // Thin gold strip hugging the inside of the arched opening, drawn as
    // a shape = arch path thickened outward by `t`.
    const t = Math.min(archR * 0.12, 0.18);
    const outer = new THREE.Shape();
    outer.moveTo(-ix - t, iyBot);
    outer.lineTo(-ix - t, iyTop - archR);
    outer.quadraticCurveTo(-ix - t, iyTop + t, -ix + archR, iyTop + t);
    outer.lineTo(ix - archR, iyTop + t);
    outer.quadraticCurveTo(ix + t, iyTop + t, ix + t, iyTop - archR);
    outer.lineTo(ix + t, iyBot);
    outer.lineTo(ix, iyBot);
    outer.lineTo(ix, iyTop - archR);
    outer.quadraticCurveTo(ix, iyTop, ix - archR, iyTop);
    outer.lineTo(-ix + archR, iyTop);
    outer.quadraticCurveTo(-ix, iyTop, -ix, iyTop - archR);
    outer.lineTo(-ix, iyBot);
    outer.lineTo(-ix - t, iyBot);

    const bead = new THREE.Mesh(new THREE.ShapeGeometry(outer), this.mGoldHi);
    bead.position.z = 0.42;
    this.group.add(bead);
  }

  private buildValance(
    _w: number,
    _h: number,
    _col: number,
    topH: number,
    iyTop: number,
    innerW: number,
  ) {
    // Swagged valance with 5 deep scallops and a central higher point.
    const valH = topH * 1.1;
    const swags = 5;
    const sw = innerW / swags;
    const dip = valH * 0.55;
    const lift = valH * 0.2;

    const shape = new THREE.Shape();
    shape.moveTo(-innerW / 2, iyTop + valH * 0.2);
    shape.lineTo(innerW / 2, iyTop + valH * 0.2);
    shape.lineTo(innerW / 2, iyTop - lift);
    for (let i = swags - 1; i >= 0; i--) {
      const xMid = -innerW / 2 + sw * (i + 0.5);
      const xEnd = -innerW / 2 + sw * i;
      // Center swag dips less; others dip more.
      const isCenter = i === Math.floor(swags / 2);
      const d = isCenter ? dip * 0.55 : dip;
      shape.quadraticCurveTo(xMid, iyTop - lift - d, xEnd, iyTop - lift);
    }
    shape.lineTo(-innerW / 2, iyTop + valH * 0.2);

    const val = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.mRed);
    val.position.z = -0.2;
    this.group.add(val);

    // Gold rope along the scalloped bottom edge (approximated by a row of
    // small gold beads stepping along the swag curve).
    const ropeSteps = swags * 8;
    const beadGeoms: THREE.BufferGeometry[] = [];
    const beadProto = new THREE.SphereGeometry(sw * 0.03, 6, 4);
    for (let i = 0; i <= ropeSteps; i++) {
      const t = i / ropeSteps;
      const x = -innerW / 2 + t * innerW;
      const st = t * swags;
      const phase = st - Math.floor(st);
      const swagIdx = Math.floor(st);
      const isCenter = swagIdx === Math.floor(swags / 2);
      const d = isCenter ? dip * 0.55 : dip;
      // Match the valance's quadratic-bezier bottom edge, whose midpoint
      // sits at only d/2 below the endpoints.
      const y = iyTop - lift - 2 * d * phase * (1 - phase);
      const g = beadProto.clone();
      g.translate(x, y, -0.1);
      beadGeoms.push(g);
    }
    beadProto.dispose();
    const ropeGeom = mergeGeometries(beadGeoms, false);
    for (const g of beadGeoms) g.dispose();
    const rope = new THREE.Mesh(ropeGeom, this.mGoldHi);
    this.group.add(rope);

    // Central tassel hanging from the middle swag.
    const centerSwag = Math.floor(swags / 2);
    const cx = -innerW / 2 + sw * (centerSwag + 0.5);
    const cy = iyTop - lift - dip * 0.55;
    this.tassel(cx, cy, sw * 0.14, -0.05);
  }

  private buildSideCurtains(
    _col: number,
    _topH: number,
    _baseH: number,
    ix: number,
    iyTop: number,
    iyBot: number,
  ) {
    const innerH = iyTop - iyBot;
    const drapeW = Math.min(ix * 0.17, 0.9);
    const tieY = iyBot + innerH * 0.42;

    for (const side of [-1, 1] as const) {
      // Extend past the opening; the frame face (at a higher z) covers
      // the overlap and there's no perspective gap along the inner edge.
      const outX = side * (ix + 0.3);
      const innerTop = side * (ix - drapeW * 0.8);
      const cinch = side * (ix - drapeW);
      const innerBot = side * (ix - drapeW * 0.9);

      // Simple straight-edged drape with a single pinch at the tie-back.
      const shape = new THREE.Shape();
      shape.moveTo(outX, iyTop);
      shape.lineTo(outX, iyBot);
      shape.lineTo(innerBot, iyBot);
      shape.lineTo(cinch, tieY);
      shape.lineTo(innerTop, iyTop);
      shape.lineTo(outX, iyTop);

      const drape = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.mRed);
      drape.position.z = -0.1;
      this.group.add(drape);

      // Tie-back: thin horizontal gold band wrapping the cinch point.
      const tbX = side * (ix - drapeW * 0.85);
      const tbW = drapeW * 0.35;
      const tbH = drapeW * 0.08;
      const bandShape = new THREE.Shape();
      bandShape.moveTo(-tbW / 2, tbH / 2);
      bandShape.lineTo(tbW / 2, tbH / 2);
      bandShape.lineTo(tbW / 2, -tbH / 2);
      bandShape.lineTo(-tbW / 2, -tbH / 2);
      bandShape.lineTo(-tbW / 2, tbH / 2);
      const band = new THREE.Mesh(new THREE.ShapeGeometry(bandShape), this.mGoldHi);
      band.position.set(tbX, tieY, 0.12);
      this.group.add(band);

      // Tassel hanging just below the tie-back.
      this.tassel(tbX, tieY - drapeW * 0.22, drapeW * 0.12, 0.18);
    }
  }

  private tassel(x: number, y: number, size: number, z: number) {
    // Short gold cord + bulb on top + fringed skirt hanging below.
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(size * 0.05, size * 0.05, size * 0.5, 8),
      this.mGoldLo,
    );
    cord.position.set(x, y + size * 0.25, z);
    this.group.add(cord);

    // Bulb (the "head" of the tassel).
    const head = new THREE.Mesh(new THREE.SphereGeometry(size * 0.25, 14, 10), this.mGold);
    head.position.set(x, y, z);
    this.group.add(head);

    // Fringed skirt: a cone with apex at the bulb and wide base hanging down.
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(size * 0.32, size * 0.8, 16), this.mGoldHi);
    skirt.position.set(x, y - size * 0.45, z);
    this.group.add(skirt);

    // Small cap between bulb and skirt.
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(size * 0.12, size * 0.2, size * 0.08, 12),
      this.mGold,
    );
    cap.position.set(x, y - size * 0.1, z);
    this.group.add(cap);
  }

  private buildOrnaments(
    w: number,
    h: number,
    col: number,
    topH: number,
    baseH: number,
    _stageH: number,
    _ix: number,
    _iyTop: number,
    _iyBot: number,
  ) {
    // === Top pediment: prominent central shell. ===
    // Shell base sits at the bottom of the top frame; it rises through the
    // whole top band.
    const iyTopFrame = h / 2 - topH;
    const shellR = topH * 0.95;
    const fanY = iyTopFrame + topH * 0.05;
    const fan = new THREE.Mesh(new THREE.CircleGeometry(shellR, 48, 0, Math.PI), this.mGoldHi);
    fan.position.set(0, fanY, 0.52);
    this.group.add(fan);
    // Flute ridges radiating out from the boss.
    const flutes = 11;
    for (let i = 0; i < flutes; i++) {
      const a = Math.PI * ((i + 0.5) / flutes);
      const x = Math.cos(a) * shellR * 0.9;
      const y = Math.sin(a) * shellR * 0.9;
      const ridge = new THREE.Mesh(
        new THREE.CylinderGeometry(shellR * 0.02, shellR * 0.02, shellR * 0.95, 6),
        this.mGoldLo,
      );
      ridge.position.set(x * 0.5, fanY + y * 0.5, 0.55);
      ridge.rotation.z = a - Math.PI / 2;
      this.group.add(ridge);
    }
    // Central boss at the shell's base.
    const boss = new THREE.Mesh(new THREE.SphereGeometry(shellR * 0.22, 16, 12), this.mGold);
    boss.position.set(0, fanY, 0.6);
    this.group.add(boss);

    // === Column ornaments: central acanthus motif on each column face. ===
    for (const sx of [-1, 1] as const) {
      const cx = sx * (w / 2 - col / 2);
      const cy = 0;
      // Vertical gold diamond (stylized leaf).
      const leafH = col * 1.8;
      const leafW = col * 0.55;
      const leaf = new THREE.Shape();
      leaf.moveTo(0, leafH / 2);
      leaf.quadraticCurveTo(leafW / 2, leafH * 0.15, 0, -leafH / 2);
      leaf.quadraticCurveTo(-leafW / 2, leafH * 0.15, 0, leafH / 2);
      const leafMesh = new THREE.Mesh(new THREE.ShapeGeometry(leaf), this.mGoldHi);
      leafMesh.position.set(cx, cy, 0.48);
      this.group.add(leafMesh);
      // Small horizontal ribs at top and bottom of leaf.
      for (const ry of [-leafH / 2 - col * 0.15, leafH / 2 + col * 0.15]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(col * 0.6, col * 0.08, 0.1), this.mGold);
        rib.position.set(cx, cy + ry, 0.48);
        this.group.add(rib);
      }
    }

    // === Urn finials crowning each column — fit entirely inside the top
    // frame band so they don't clip off-screen. ===
    const urnTotalH = topH * 0.42;
    const urnW = Math.min(col * 0.38, urnTotalH * 0.45);
    for (const sx of [-1, 1] as const) {
      const cx = sx * (w / 2 - col / 2);
      // Center the urn vertically inside the top frame band so it doesn't
      // clip against the window edge.
      const cy = h / 2 - topH * 0.5 - urnTotalH * 0.5;
      // Square plinth the urn sits on.
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(col * 0.9, urnTotalH * 0.12, 0.35),
        this.mGold,
      );
      plinth.position.set(cx, cy - urnTotalH * 0.04, 0.55);
      this.group.add(plinth);
      // Urn body — lathe profile for a shapely silhouette, sized to fit.
      const urnPts = [
        new THREE.Vector2(0.0, 0),
        new THREE.Vector2(urnW * 1.0, 0),
        new THREE.Vector2(urnW * 0.9, urnTotalH * 0.08),
        new THREE.Vector2(urnW * 1.2, urnTotalH * 0.2),
        new THREE.Vector2(urnW * 1.3, urnTotalH * 0.42),
        new THREE.Vector2(urnW * 1.0, urnTotalH * 0.62),
        new THREE.Vector2(urnW * 0.6, urnTotalH * 0.72),
        new THREE.Vector2(urnW * 0.3, urnTotalH * 0.8),
        new THREE.Vector2(urnW * 0.7, urnTotalH * 0.88),
        new THREE.Vector2(urnW * 0.35, urnTotalH * 0.96),
        new THREE.Vector2(0.0, urnTotalH * 1.0),
      ];
      const urn = new THREE.Mesh(new THREE.LatheGeometry(urnPts, 24), this.mGoldHi);
      urn.position.set(cx, cy, 0.7);
      this.group.add(urn);
    }

    // === Base apron central cartouche — mirror of the pediment. ===
    const baseY = -h / 2 + baseH / 2;
    const cShellR = baseH * 0.55;
    const cShell = new THREE.Mesh(new THREE.CircleGeometry(cShellR, 32, 0, Math.PI), this.mGoldHi);
    cShell.rotation.z = Math.PI; // open downward
    cShell.position.set(0, baseY + baseH * 0.1, 0.45);
    this.group.add(cShell);
    const cBoss = new THREE.Mesh(new THREE.SphereGeometry(cShellR * 0.22, 14, 10), this.mGold);
    cBoss.position.set(0, baseY + baseH * 0.1, 0.55);
    this.group.add(cBoss);
    this.scroll(-cShellR * 1.3, baseY + baseH * 0.05, baseH * 0.3, -1);
    this.scroll(cShellR * 1.3, baseY + baseH * 0.05, baseH * 0.3, 1);

    // Small corner cartouches on the base (left and right of center).
    for (const sx of [-1, 1] as const) {
      const x = sx * (w / 2 - col * 1.3);
      const y = baseY;
      const diamond = new THREE.Mesh(new THREE.CircleGeometry(baseH * 0.22, 16), this.mGoldLo);
      diamond.scale.set(0.7, 1, 1);
      diamond.position.set(x, y, 0.4);
      this.group.add(diamond);
    }
  }

  private scroll(cx: number, cy: number, size: number, dir: 1 | -1) {
    // Flat scroll = annular ring (C-shape) with a filled curl at one end.
    // Build by subtracting a smaller concentric disc from a larger one so
    // the result is a clean "O" ring, then add a tail extending outward.
    const outer = new THREE.Shape();
    outer.absarc(0, 0, size * 0.5, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, size * 0.25, 0, Math.PI * 2, true);
    outer.holes.push(hole);
    const ring = new THREE.Mesh(new THREE.ShapeGeometry(outer), this.mGoldHi);
    ring.position.set(cx, cy, 0.5);
    this.group.add(ring);

    // Tail: a quarter-torus sweeping outward from the ring, tangent to it.
    const tail = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.7, size * 0.08, 8, 20, Math.PI * 0.6),
      this.mGoldHi,
    );
    tail.position.set(cx - dir * size * 0.7, cy, 0.5);
    tail.rotation.z = dir > 0 ? -Math.PI * 0.2 : Math.PI * 1.2;
    this.group.add(tail);

    // Inner solid eye at the center of the ring.
    const eye = new THREE.Mesh(new THREE.CircleGeometry(size * 0.12, 16), this.mGold);
    eye.position.set(cx, cy, 0.53);
    this.group.add(eye);
  }

  setVisible(on: boolean) {
    this.root.visible = on;
  }
}
