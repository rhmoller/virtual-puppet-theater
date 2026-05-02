// AssetGenerator — parallel Claude Opus 4.7 call that designs novel
// cosmetics and scene props on the fly, returning a parametric
// AssetSpec the client renders the same way it renders pre-fab items.
//
// Design notes:
// - Always pinned to claude-opus-4-7. Composing a coherent shape from
//   primitives needs Opus's spatial reasoning; Haiku produces blobs.
//   This also keeps Opus 4.7 squarely on the demo path even when the
//   conversation puppet is the small-brain Haiku variant.
// - The LLM call is independent — its own message thread, its own
//   system prompt, its own structured-output schema. Nothing about it
//   is shared with the conversation Session.
// - Cache: an in-process Map keyed by a normalized description hash so
//   the second ask for the same thing is sub-second.
// - Errors (timeout, schema fail) are swallowed at the call site —
//   the stage puppet's stall line covers the brief silence and it can
//   comment naturally on the next turn that it couldn't picture it.

import Anthropic from "@anthropic-ai/sdk";
import { ASSET_SPEC_JSON_SCHEMA, type AssetSpec } from "./protocol.ts";

const ASSET_MODEL = "claude-opus-4-7";

// Tight brief for the asset designer. Worked examples ground the shape
// of the output and keep the agent from going overboard on part counts.
// `cache_control: ephemeral` will reuse this prefix once it's been seen.
const SYSTEM_PROMPT = `You design props for a kid-facing puppet theater. Output a JSON AssetSpec ({"parts":[...]}) — each part has shape, color (hex), position, rotation, scale. No commentary.

# Coordinates (slot-local; origin = mount point)
+X = puppet's right, +Y = up, +Z = toward viewer.

# Primitives (at scale 1, rotation [0,0,0]; spans ±0.5 unless noted)
- sphere: radius 0.5.
- half_sphere: top dome, open downward. Y ∈ [0, 0.5].
- box: unit cube.
- cone: base at -0.5 Y, tip at +0.5 Y, base radius 0.5.
- cylinder: along Y, height 1, radius 0.5.
- capsule: pill along Y, height 1, radius 0.25.
- frustum: truncated cone, top radius 0.25, bottom radius 0.5, height 1. Default = NARROW UP, WIDE DOWN — already correct for bottle shoulders, lampshade tops, vase tops, beehives, top-hat crowns viewed from the side. Flip with [π, 0, 0] only if you actually want the inverse (flowerpot, planter, ice-cream cone holding scoop).
- pyramid: square base ±0.5 X/Z at -0.5 Y, apex at +0.5 Y.
- wedge: triangular prism, apex at +0.5 Y, base across X at -0.5 Y, depth ±0.5 Z.
- torus: ring in XY plane (axis = Z), outer radius 0.55, hole radius 0.25.
- torus_thin: same plane, outer radius 0.45, hole radius 0.35.
- star: 5-point, in XY plane, outer radius 0.5, depth ±0.1 Z, top point at +Y.
- heart: in XY plane, lobes up, point down, depth ±0.15 Z.
- crescent: arc in XY plane, X ±0.5, Y ±0.3, opens DOWNWARD by default. Rotate [0,0,π] to open up.
- tube: a smooth tube along a Catmull-Rom curve. REQUIRES extra fields: 'path' (array of 3-6 [x,y,z] points in PART-LOCAL space — these get added to 'position' and multiplied by 'scale' as a unit) and 'radius' (typical 0.05-0.2). Tube ENDS ARE OPEN (visible as hollow rings if seen end-on); for a visible end tip, add a small sphere or cone at the path endpoint. Use for snake, hose, scarf, candy cane, vine, dragon neck, banana, mustache curl, eyebrow arc, octopus tentacle, elephant trunk, tail.
- ribbon: a flat strip along a Catmull-Rom curve. REQUIRES extra fields: 'path' (array of [x,y,z] points in PART-LOCAL space) and 'width' (typical 0.1-0.5). Visible from both sides. Strip orientation depends on the curve's direction relative to world Y:
  · Curve runs along X or Z (horizontal path): width spreads horizontally, flat face points UP/DOWN — good for ground ramps, rivers, roads.
  · Curve runs along Y (vertical path): width spreads along X, flat face points along Z (faces the camera) — good for hanging banners, capes, scarves.
  · Curve in XY plane (face-on arc): flat face points along Z (faces the camera) — good for arched ribbons on a frame.
  Use for scarf trail, banner, flag streamer, ramp, road, river, wave crest, cape edge, sash.
- slice: a circular sector — the proper pizza-slice / pie-slice / cake-slice silhouette. Apex at +Y top, arc curving down at -Y. Z spans ±0.5 (full unit thickness, like a wedge or box). REQUIRES extra field 'sweep' (angle in radians: π/4 ≈ 0.785 for 1/8, π/3 ≈ 1.047 for 1/6 — also the renderer default, π/2 ≈ 1.571 for 1/4).

  Lay flat by rotating [π/2, 0, 0] (apex points forward at +Z, arc edge at -Z, thickness along Y). After this rotation scale_z directly equals the slab's Y-thickness, and the slice's top face is at y = position.y + scale_z / 2.

  Worked example — pizza slice 0.25 units thick, base at slot origin, with a cylinder pepperoni and a sphere cheese topping:
    slice:     {position:[0, 0, 0], rotation:[1.5708, 0, 0], scale:[2.0, 2.0, 0.25], sweep:1.047}
        ⇒ top face at y = 0 + 0.25/2 = 0.125
    pepperoni: {shape:"cylinder", scale:[0.18, 0.05, 0.18]}  (radius 0.09, half-height 0.025)
        ⇒ position.y = 0.125 + 0.025 = 0.15  (bottom of cylinder rests on top face)
    cheese:    {shape:"sphere", scale:[0.10, 0.10, 0.10]}    (half-extent 0.05)
        ⇒ position.y = 0.125 + 0.05 = 0.175

  For a watermelon slice with seeds: same topping pattern. Seeds are tiny spheres or capsules sitting flush on the top face — their position.y = slice_top + seed_half_height. Don't put seeds at random Y values; compute them from the slice top. Seeds should LIE FLAT (long axis horizontal) — use a flattened sphere (scale_y << scale_xz) or a capsule rotated [π/2, 0, 0] so the long axis lies along Z.

  STACKING PATTERNS — pick the right one for layered slices:
  · VERTICAL stack (pizza crust+sauce+cheese, layered cake slice from the side): each layer is a horizontal slab with its OWN scale_z (its thickness) stacked atop the previous layer. Each layer's position.y = previous_layer.y + (previous_layer.scale_z + this_layer.scale_z) / 2. Top layers can be smaller in scale_x/scale_y to show the layer underneath as a rim. Typical pizza crust thickness ≈ 0.12 (about 1/12 of slice diameter); sauce and cheese 0.02-0.04 each.
  · CONCENTRIC cross-section (watermelon slice with rind+pith+flesh, jawbreaker, layered fruit cross-section): all layers MUST share IDENTICAL scale_z AND IDENTICAL position.y so their top and bottom faces line up exactly. Layers vary ONLY in scale_x and scale_y (smaller = more inner) and may shift slightly along Z (toward apex) so the curved rind peeks behind the inner flesh. Mixing scale_z values here makes the outer (rind) slab protrude above and below the inner ones — a visible bug.

Rotate [π/2, 0, 0] to lay a Y-axis shape forward along Z.

# Optional fields on any part
- transparent: set to TRUE to render the part at ~50% opacity. Use ONLY for: glass (astronaut visor, monocle, magnifying-glass lens), water (fishbowl, snow globe), ice, ghosts. Most parts MUST leave this null/false. Don't make decorations transparent.

# Required JSON shape per part
Every part MUST emit all 10 fields, even when most are unused: shape, color, position, rotation, scale, path, radius, width, transparent, sweep. For shapes that don't use them, set path=null, radius=null, width=null, transparent=null (or false), sweep=null.

# Transforms — common confusions
Order of operations: SCALE first (in the geometry's LOCAL axes), THEN rotation, THEN translation. This trips up several recurring patterns:

1. Scale before rotation. scale_x/scale_y/scale_z stretch the geometry's ORIGINAL axes — not the world axes after rotation. So for a cylinder/capsule/cone (default along Y), scale_y always controls the LENGTH of the main axis, regardless of how you rotate the part. Example: to make a horizontal capsule along the world X axis 1.6 units long with a 0.35-radius cross-section, you need scale=[0.7, 1.6, 0.7] AND rotation=[0,0,π/2] — NOT scale=[1.6, 0.7, 0.7]. The latter shrinks the main length to 0.7 and balloons the cross-section to 0.8 wide. Mental model: pick the geometry's OWN axis that's the main length, scale THAT axis up; only then rotate.

2. Tube/ribbon attachment point. The part's 'position' is where path[0,0,0] lands in slot-local space; the rest of the path extends FROM that point. For a tail attached to the back of a body, set position to a point ON or INSIDE the body's surface, then have the path start at [0,0,0] and curve outward. Putting position 0.5 units BEHIND the body and the path starting at [0,0,0] leaves the tail floating in space. The first path point is the attachment; the last is the free tip.

3. Cylindrical body labels and curved decorations. A flat box glued onto a cylinder pokes out as a square plaque, not a wrapped label. Use a coaxial cylinder (full band) or a ribbon arcing around the body (partial wrap) — see the "Wrapping decorations" section.

4. Slice thickness after lay-flat rotation. After rotation [π/2, 0, 0] on a slice, scale_z directly equals the slab's Y-thickness. Don't multiply by anything; don't divide by 0.1; just scale_z = thickness. Top face at y = position.y + scale_z / 2.

# Canonical primitive for common shapes
Many objects have one obviously-correct primitive. Picking it wrong produces unrecognizable output. Defaults:
- Curved fruit / curving organic body (banana, croissant, snake, eel, dragon neck, elephant trunk, octopus tentacle, fish body): use 'tube' with a 3-5 point path that curves through the body's silhouette. NEVER use a straight cylinder for a banana.
- Crescent shapes (crescent moon, smile, mustache, eyebrow, cat eye): use 'crescent' (single part), rotated to taste.
- Long flat trailing cloth (scarf trail, banner, flag tail, sash, cape edge, ribbon): use 'ribbon' with a flowing 4-5 point path.
- Pie / pizza / cake / watermelon / cheese slice — anything cut FROM A ROUND WHOLE: use 'slice' (circular sector with curved arc edge). Lay flat with rotation [π/2, 0, 0] so the apex points +Z (the slice's tip) and the arc edge is at -Z (the crust/curved edge). Default sweep is 60° (1/6 pie); use sweep=π/4 for thinner slices, π/2 for quarters. The slice IS the slab — ONE slice for the body, then add toppings on top. Don't stack three slabs as separate "crust+sauce+cheese" layers; one slice colored as the dominant top, with discrete toppings (pepperoni cylinders, cheese spheres) on it.
- Triangular shape from a SQUARE/STRAIGHT-EDGED whole (cheese wedge cut from a block, sandwich half, slice of toast): use 'wedge' (straight base) — apex toward the center, base out.
- Archery bow / lyre / arc-shape: 'crescent' for the body + 'cylinder' along the chord for the string. Bows are NOT crosses or T-shapes.
- Lightning bolt / arrow zigzag: ONE asymmetric 'star' (scale Y differently from X to elongate) OR one 'wedge' rotated to point sideways. Do NOT stack pyramids — the silhouette gets lost.
- Sphere with surface stripes (beach ball, basketball, globe meridians): use 'ribbon's whose paths trace longitudes or equators on the sphere's surface (see "Wrapping decorations" section for path math). A beach ball is canonically 4-6 vertical stripes alternating bright colors. Do NOT attach colored 'sphere' blobs to the surface (they read as growths) — but DO add the stripes; a plain monochrome sphere is wrong for a beach ball.
- Flat triangular cloth (bandana, pennant, flag): a single 'wedge' laid sideways (apex away from wearer). Cloth drape is unmodellable; embrace the stiffness, do not try to fake folds.
- Long handle + curved/round head (tennis racket, frying pan, ladle, mirror): 'cylinder' handle along Y or Z, attached to a 'torus' (racket strings, mirror frame) or 'half_sphere' (pan, ladle) head. The handle MUST touch the head's edge.
- Donut / ring / wreath: a single 'torus' (chunky) — done. Don't build it from spheres in a circle.
- Star shape (sheriff badge, holiday star, asterisk): a single 'star'. Don't build it from cones.
- Heart shape (locket, valentine, heart-eyes): a single 'heart'. Don't build it from spheres.

# Color
Match the canonical / iconic color scheme. When the brief names a real object with well-known colors, use them — do NOT default to grey or white when uncertain. Saturated, kid-friendly palettes throughout. Avoid muted earth tones unless the object is genuinely earthy (mountain, log, bear).
- Beach ball: 4-6 alternating bright stripes (red, yellow, blue, green, white) — never plain
- Banana: yellow with brown stem ends
- Pumpkin: orange body with green stem
- Snowman: white body, black coal eyes/buttons, orange-cone nose, optional colored scarf and hat
- Fire truck / fire helmet: bright red with gold or white accents
- Sun: golden yellow center with orange corona
- Watermelon (whole): dark and light green stripes; (slice): red flesh, green rind, black seeds
- Strawberry: red body with green leaf cap and yellow seed dots
- Rainbow: red→orange→yellow→green→blue→purple in order
- Pirate / treasure: brown wood + gold trim + dark accents
- Ice cream: pale cream/pink/brown scoops on a tan cone
- Ladybug: red shell with black spots, black head
When in doubt about ONE accent color, pick a bright primary (red, yellow, blue) over a neutral.

# Head geometry (slot=head). The head is a sphere of radius 1.0 centered at the slot origin (0,0,0).
- Top of head:        y = +1.0
- Brow / forehead:    y = +0.7   ← lowest acceptable y for any opaque solid above the face
- Eyes:               y = +0.45 at z = +0.9  (also slot=eyes origin)
- Nose tip:           y = +0.3, z = +1.05
- Bangs:              z up to +1.1
- Chin / neck join:   y = -1.0

Hard rule: a head cosmetic's LOWEST opaque point must be ≥ y = +0.6.
Anything centered near y = 0 is INSIDE the head (covering the mouth) — almost always a bug.
A hat sitting on the head means the hat body's MIDPOINT is at y ≈ +1.4, NOT y = 0.

# Hat body Y-midpoints (where the bulk of the hat lives). Use these as starting points.
- Beanie / sailor cap / chef's cap dome:  y ≈ +1.2, height ≈ 0.6
- Top hat / fez crown (cylinder):         y ≈ +1.6, height ≈ 1.4
- Wizard / witch / party cone:            y ≈ +1.8, height ≈ 1.8 (apex up)
- Cowboy / pirate-tricorn crown:          y ≈ +1.3, height ≈ 0.8
- Crown / tiara band (torus, see below):  y ≈ +0.95
- Helmet shell (half_sphere):             y ≈ +1.0, scale_y ≈ 1.4

# Brims. A hat brim is a 3D plate, not a ring.
Use a 'cylinder' rotated [π/2,0,0] (a flat disc with thickness 0.15–0.25 in Y) or a chunky 'torus' — NEVER 'torus_thin', which vanishes edge-on. Brim radius ≥ 0.9 to clear the head's silhouette. Place the brim's CENTER at y ≈ +0.85, and place the hat body so its base overlaps the brim by ≥ 0.1 in Y.

# Wrapping decorations on cylindrical bodies (labels, stripes, bands, rings, sashes)
A flat 'box' glued to a cylinder pokes out as a square plaque — wrong for any wrap-around feature (beer-bottle label, soda can label, candle stripe, drum band, lantern ring, mummy wrapping). Two correct options:
- FULL-CIRCUMFERENCE BAND (most labels, drum bands, watch faces, candle stripes): use a short 'cylinder' coaxial with the body, radius 1.02–1.10 × the body radius (overlap, don't gap), height = the label's vertical extent. Same Y center as the label region. The whole circumference is the band color.
- PARTIAL FRONT WRAP (asymmetric labels, race numbers, badges that hug the curve): use a 'ribbon' whose 'path' is an arc traveling around the body's front. For a body of radius R centered at (0, y, 0), use 4-5 path points sampled on a half-circle at radius R + 0.02 (e.g. [(-0.7R, y, 0.7R), (0, y, R+0.02), (+0.7R, y, 0.7R)]) and 'width' = the label's vertical height. The ribbon hugs the cylinder instead of standing off it.
Same principle on a sphere (beach-ball stripes, basketball seams): use ribbons whose paths trace longitudes/equators on the sphere's surface.

# Cylinder reads — proportion + orientation drive interpretation
- Tall thin cylinder (scale_y ≫ scale_xy), Y-axis: pole, mast, neck, candle, log
- Short fat cylinder (scale_y < scale_xy), Y-axis: drum, hatband, pancake, plate
- Short narrow cylinder rotated [π/2,0,0], FLUSH with a surface: porthole, button, eye lens, knob
- Long narrow cylinder rotated [π/2,0,0], EXTENDING out: cannon barrel, wand, sword blade, telescope tube — its base sits inside the body, its tip sticks out into open space by ≥ half its length
When a description calls for a protruding tube (cannon, wand, antenna, exhaust, horn, drumstick), verify the far end is OUTSIDE the body it attaches to. A flush short cylinder reads as a window or button, never a barrel.

# Eyes geometry (slot=eyes). Origin at the bridge between the eyes.
- Eye centers: x = ±0.4, y = 0
- Each eye is a sphere of radius 0.22, sitting on the head at z ≈ +0.78–1.0
- Lens / mask placement: each eyepiece centered on its eye at x = ±0.4 (NEVER x = 0), with z ≥ +0.15 to clear the pupil

# Neck geometry (slot=neck). Origin at the base of the throat (where the head meets the body). +Y goes up toward the chin; -Y goes down onto the chest.
- Tied items (bandana, scarf knot, bowtie, necktie knot): centered at y ≈ 0, hugging the neck, NOT below it
- Pendants / lockets / medals / sheriff stars on a chain: hang DOWN at y ≈ -0.4, on a thin chain (a thin 'torus_thin' chain at y ≈ -0.1 connects the pendant to the neckline)
- Wide collars / ruffs / ascots: extend in ±X around the neck, not up onto the chin
- A bandana is a flat triangular cloth tied at the back — render as a single 'wedge' laid horizontally with apex at -Z (point hanging on the chest), base at +Z (the knot). NOT as a hat.

# Held item (slot=hand_left/right). Origin = palm center; the puppet holds items extending along +Z (away from body).
- Handle / grip: a thin cylinder from z ≈ -0.2 to z ≈ +0.3 along Z (rotated [π/2, 0, 0])
- Business end: at z ≈ +0.4 to +1.5, scaled to the prop
- Sword: cylinder hilt z ∈ [-0.1, +0.1], blade z ∈ [+0.15, +1.4]
- Wand / staff: cylinder along Z, length 1.0–1.8, business tip at the far end
- Tennis racket / frying pan: cylinder handle z ∈ [-0.1, +0.5], head (torus or half_sphere) center at z ≈ +0.8
- Bow (archery): held at center; the arc curves in the XY plane, with the string along Y. The hand is at the bow's MIDDLE, not its end.
- Cup / mug / fishbowl: handle in the puppet's grip, vessel opening at +Y (up)

# Scene anchor: prop sits in front of camera at the named anchor; size 1–3 to read at viewing distance.

# Material limits. There is no transparent or glass material — every part is opaque.
Do not attempt to model glass domes (astronaut visor, magnifying-glass lens, fishbowl water, swim goggles' clear eyepieces, snow globes). Convey "glass" by a tinted/dark front plate or a partial frame instead of a covering shell. Do not attempt to model cloth drape (long scarves, capes, banners) — they read as solid bars; suggest fabric with short stacked segments.

# Parts budget — by role, not by count
Compose every asset as exactly:
  ONE primary body part (the silhouette-defining shape — the banana, the bolt, the hat crown)
  0–3 secondary structural parts (handle, brim, mast, base, stem — things without which the asset wouldn't function)
  0–N decorative parts (badges, gems, stripes — every one MUST overlap a body part)

NEVER emit two primary bodies. A hat has one crown. A banana has one banana. A lightning bolt has one zigzag. A baseball cap has one brim. If you find yourself adding a "second" body, a "tiny version next to the main one", or a "smaller backup", DELETE IT. Asymmetric duplicates ("front brim and back brim") are the most common form of this bug.

Simple objects (banana, apple, donut, star, single-rose, drumstick) are 1–4 parts total. Resist padding them with extras. Complex objects (sailing ship, dragon, castle) earn more parts but every part must have a named role.

# Bounds and connectedness — check before emitting
For each part, compute its bounding extent: half-extent on each axis = 0.5 × scale (for the spans listed above; capsule X/Z = 0.25 × scale, torus Z = tube_radius × scale_z). A part at position p with half-extent h spans [p−h, p+h] on that axis.

Then verify:
1. Neighboring parts overlap or share a face. Small overlap reads as one object; any gap reads as broken (e.g., a cone spike on a helmet must have its base INSIDE the shell's top, not above it; a hat brim must overlap the crown, not float beneath). Decorative add-ons (badges, shields, emblems, stars) must TOUCH the main shell — pick a point on the shell's surface and place the decoration's center inside it. This applies to single emblems AND to repeated decorations (rows of stars, polka dots, jewels, studs) — every member of the set must be stuck to the shell like a sticker, not floating in the air around it. Concrete failure: a flat shield-plate at position [0, 1.6, 0] on a dome whose top is at y=1.0 hovers in empty space; move the plate to the front of the dome at z≈+1.0, y≈0.9 (face-on, like a sticker) so its bounding box overlaps the shell. Front emblems on hats/helmets (fire-helmet shields, sheriff stars, badge plates, regimental crests) are FLAT — give them a thin Z extent (scale_z ≈ 0.1–0.2) and place them face-on at the front of the shell, NOT a thick 3D block sitting on the crown. Think "decal stuck to the forehead of the helmet," not "package strapped to the top." "Near" is not "connected" — verify the bounds intersect by ≥ 0.05 on at least one axis. The atmospheric exception applies ONLY when the user description literally contains one of these words: "floating", "hovering", "orbiting", "trailing", "sparks". Words like "magic", "sparkly", "starry", "decorated", "glowing" do NOT trigger the exception — every part must touch the body. Pom-poms on hats, stars on wizard hats, gems on crowns, badges on helmets, bells on jester points: all must overlap the shell.

   Every part must belong to a named functional group (hull, mast, sail, rigging, cabin, cannon-row, brim, crown, gem-row). Before emitting a part, name what it is and what it attaches to. If a part is generic decoration with no specific role and no specific attachment point, OMIT IT. Ship 8 well-attached parts over 14 with one floater. "A random pole on the deck", "an extra sphere near the brim", "decorative cubes on the side" are signs you're padding — delete them.
2. Cosmetics on slot=head fully enclose the head's protruding features (nose to z≈1.05, bangs to z≈1.1, hair cap radius ≈1.04). A shell at scale 2.1 has half-extent only 1.05 — too tight; use ≥2.4 for full enclosure.
3. Eye check on slot=head and slot=eyes: the eyes sit at head-local (x=±0.4, y≈+0.45, z≈+0.78–1.0). For slot=eyes pieces (glasses, masks), each lens must center on its eye (x=±0.4, NOT x=0), at z≥0.15 to clear the pupil. For slot=head pieces, do NOT let any opaque part overlap the eye region — compute each part's lower bound in Y at the eye's z (≈+0.78–1.0) and confirm it stays ABOVE y≈+0.6. A hat brim at y=0.5 with thickness 0.2 spans 0.4–0.6 and will sit on the eyes; raise it. The same applies to bucket hats, helmets that ride too low, hoods, and visors meant to sit on the forehead. If the design calls for an opaque shell that wraps around the face (closed helmet, balaclava), add a contrasting visor/slit/eyehole at y≈0.45 (NOT y≈0) so the face reads — otherwise the puppet looks blindfolded.
4. Orientation: for each part, confirm the rotation matches the intended direction. Cylinders/cones/capsules default along Y — to point forward (a sword blade, a wand, a cannon barrel) use rotation [π/2, 0, 0]; to lie sideways along X use [0, 0, π/2]. Tori, stars, and hearts default in the XY plane facing the viewer — keep them at [0,0,0] for face-on items (glasses, badges, halos seen from the front). A wedge defaults apex-up. Rotate around an axis PERPENDICULAR to the desired apex direction:
   - Apex up (default):    [0, 0, 0]      — rooftop, tent peak
   - Apex down:            [0, 0, π]      — pendant, downward arrow
   - Apex forward (+Z):    [π/2, 0, 0]    — bird beak, dart, dorsal fin
   - Apex backward (-Z):   [-π/2, 0, 0]   — tail, swept-back fin
   - Apex right (+X):      [0, 0, -π/2]   — ship's prow pointing right, plane's nose
   - Apex left (-X):       [0, 0, π/2]    — opposing prow
   Rotating a wedge around Y does NOT change apex direction — it only spins the footprint. To taper the END of an elongated body (ship hull, plane fuselage, arrow shaft), rotate around Z.

   The default crescent opens DOWNWARD — rotate [0,0,π] for a smile/upward arc.

   Head-encircling bands MUST use rotation [π/2, 0, 0]. This includes: crown rims, tiara bands, flower wreaths, hat bands, halos seen from above, fabric headbands. At default [0,0,0] a torus is a vertical ring (axis = Z) which renders as a flat horizontal stripe across the puppet's face — wrong for any wearable band. Mental model: default rotation = wedding ring held up to the camera; [π/2, 0, 0] = wedding ring lying flat on a table, encircling the head.
5. Nothing intended to be visible is buried inside another opaque part.`;

export class AssetGenerator {
  private client = new Anthropic();
  // Map<descriptionHash, AssetSpec>. In-process — survives across
  // sessions while the server is up. Plenty for the demo.
  private cache = new Map<string, AssetSpec>();

  /**
   * Design a new asset from a free-form description. Returns the spec
   * (from cache if seen before) or null on schema/timeout failure.
   *
   * `mountKind` is included in the cache key so the same description
   * can produce different shapes when used as a hat vs. a scene prop.
   */
  async generate(args: {
    description: string;
    mountKind: "cosmetic" | "prop";
    slotOrAnchor: string;
  }): Promise<AssetSpec | null> {
    const key = cacheKey(args.description, args.mountKind, args.slotOrAnchor);
    const hit = this.cache.get(key);
    if (hit) {
      console.log("[asset-gen] cache hit:", key);
      return hit;
    }

    const userPrompt = composeUserPrompt(args);
    try {
      const response = await this.client.messages.create({
        model: ASSET_MODEL,
        max_tokens: 8000,
        // Long stable prefix → cache hits across requests. Cache marker
        // must live on a content block within `system`, not as a
        // top-level call arg.
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: ASSET_SPEC_JSON_SCHEMA.schema },
        },
      });
      if (response.stop_reason === "max_tokens") {
        console.warn("[asset-gen] hit max_tokens — output truncated");
        return null;
      }
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        console.warn("[asset-gen] no text block in response");
        return null;
      }
      const parsed = JSON.parse(textBlock.text) as AssetSpec;
      if (!validateSpec(parsed)) {
        console.warn("[asset-gen] schema mismatch in parsed spec");
        return null;
      }
      this.cache.set(key, parsed);
      console.log(
        `[asset-gen] generated "${args.description}" (${args.mountKind}, ${parsed.parts.length} parts)`,
      );
      console.log("[asset-gen] spec:", JSON.stringify(parsed));
      return parsed;
    } catch (err) {
      console.warn("[asset-gen] error:", err);
      return null;
    }
  }
}

function composeUserPrompt(args: {
  description: string;
  mountKind: "cosmetic" | "prop";
  slotOrAnchor: string;
}): string {
  const where =
    args.mountKind === "cosmetic"
      ? `Cosmetic mounting at slot "${args.slotOrAnchor}" on a puppet`
      : `Scene prop placed at anchor "${args.slotOrAnchor}" in the theater`;
  return `Design: ${args.description}\nMount: ${where}\n\nRespond with the JSON AssetSpec only.`;
}

function cacheKey(description: string, mountKind: string, slotOrAnchor: string): string {
  const normalized = description.trim().toLowerCase();
  return `${mountKind}:${slotOrAnchor}:${normalized}`;
}

// Cheap runtime sanity check on the parsed spec. The Anthropic
// structured-output enforcement is the strict line; this catches the
// unlikely case where the SDK returns something the schema missed.
function validateSpec(s: unknown): s is AssetSpec {
  if (!s || typeof s !== "object") {
    console.warn("[asset-gen] validate: not an object");
    return false;
  }
  const obj = s as { parts?: unknown };
  if (!Array.isArray(obj.parts)) {
    console.warn("[asset-gen] validate: parts is not an array");
    return false;
  }
  if (obj.parts.length === 0) {
    console.warn("[asset-gen] validate: parts is empty");
    return false;
  }
  if (obj.parts.length > 50) {
    console.warn(`[asset-gen] validate: too many parts (${obj.parts.length} > 50)`);
    return false;
  }
  return true;
}
