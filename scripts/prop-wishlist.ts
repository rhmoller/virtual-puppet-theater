// Hand-curated from docs/prop-wishlist.md. The wishlist groups by mount
// implicitly; we re-encode that here so each prop has an explicit
// (mountKind, slot/anchor). Held items default to hand_right; sky props
// to sky_center; ground props to ground_center.
//
// Shared between scripts/batch-generate.ts (full-list driver) and
// scripts/refine-props.ts (random-sample feedback-loop driver).

export type Prop = {
  id: string;
  description: string;
  mountKind: "cosmetic" | "prop";
  slotOrAnchor: string;
};

function c(id: string, description: string, slot: string): Prop {
  return { id, description, mountKind: "cosmetic", slotOrAnchor: slot };
}
function p(id: string, description: string, anchor: string): Prop {
  return { id, description, mountKind: "prop", slotOrAnchor: anchor };
}

export const PROPS: Prop[] = [
  // Hats & headwear (head)
  c("wizard-hat", "wizard hat", "head"),
  c("crown", "crown", "head"),
  c("top-hat", "top hat", "head"),
  c("cowboy-hat", "cowboy hat", "head"),
  c("pirate-tricorn", "pirate tricorn", "head"),
  c("witch-hat", "witch hat", "head"),
  c("sombrero", "sombrero", "head"),
  c("baseball-cap", "baseball cap", "head"),
  c("party-hat", "party hat (cone with bobble)", "head"),
  c("beanie", "beanie", "head"),
  c("viking-helmet", "viking helmet with horns", "head"),
  c("knights-helmet", "knight's helmet", "head"),
  c("astronaut-helmet", "astronaut helmet", "head"),
  c("fire-helmet", "fire helmet", "head"),
  c("chefs-hat", "chef's hat", "head"),
  c("jester-hat", "jester hat with bells", "head"),
  c("propeller-beanie", "propeller beanie", "head"),
  c("crown-of-flowers", "crown of flowers", "head"),
  c("sailor-hat", "sailor hat", "head"),
  c("tiara", "tiara", "head"),

  // Eye accessories (eyes)
  c("sunglasses", "sunglasses", "eyes"),
  c("round-glasses", "round wire-frame glasses", "eyes"),
  c("star-sunglasses", "star-shaped sunglasses", "eyes"),
  c("heart-sunglasses", "heart-shaped sunglasses", "eyes"),
  c("monocle", "monocle", "eyes"),
  c("eye-patch", "eye patch", "eyes"),
  c("swim-goggles", "swim goggles", "eyes"),
  c("ski-goggles", "ski goggles", "eyes"),
  c("superhero-mask", "superhero bandit mask", "eyes"),
  c("masquerade-mask", "masquerade mask", "eyes"),

  // Neck accessories (neck)
  c("bowtie", "bowtie", "neck"),
  c("necktie", "necktie", "neck"),
  c("scarf", "scarf", "neck"),
  c("pearl-necklace", "pearl necklace", "neck"),
  c("heart-locket", "heart locket", "neck"),
  c("sheriff-badge", "sheriff badge", "neck"),
  c("olympic-medal", "olympic medal", "neck"),
  c("bandana", "bandana", "neck"),

  // Held items — tools, toys, magic (hand_right)
  c("magic-wand", "magic wand with star tip", "hand_right"),
  c("wooden-sword", "wooden sword", "hand_right"),
  c("pirate-cutlass", "pirate cutlass", "hand_right"),
  c("knights-lance", "knight's lance", "hand_right"),
  c("lightsaber", "lightsaber", "hand_right"),
  c("magic-staff", "magic staff", "hand_right"),
  c("royal-scepter", "royal scepter", "hand_right"),
  c("trident", "trident", "hand_right"),
  c("bow", "bow for arrows", "hand_right"),
  c("fishing-rod", "fishing rod", "hand_right"),
  c("baseball-bat", "baseball bat", "hand_right"),
  c("tennis-racket", "tennis racket", "hand_right"),
  c("hockey-stick", "hockey stick", "hand_right"),
  c("golf-club", "golf club", "hand_right"),
  c("broom", "broom", "hand_right"),
  c("mop", "mop", "hand_right"),
  c("microphone", "microphone", "hand_right"),
  c("paint-brush", "paint brush", "hand_right"),
  c("giant-pencil", "giant pencil", "hand_right"),
  c("magnifying-glass", "magnifying glass", "hand_right"),
  c("telescope", "telescope", "hand_right"),
  c("flashlight", "flashlight", "hand_right"),
  c("umbrella", "umbrella", "hand_right"),
  c("bouquet", "bouquet of flowers", "hand_right"),
  c("single-rose", "single rose", "hand_right"),
  c("lollipop", "lollipop", "hand_right"),

  // Held food (hand_right)
  c("ice-cream-cone", "ice cream cone", "hand_right"),
  c("hot-dog", "hot dog", "hand_right"),
  c("banana", "banana", "hand_right"),
  c("apple", "apple", "hand_right"),
  c("watermelon-slice", "watermelon slice", "hand_right"),
  c("pizza-slice", "pizza slice", "hand_right"),
  c("donut", "donut", "hand_right"),
  c("cupcake", "cupcake", "hand_right"),

  // Held creatures (hand_right)
  c("goldfish-bowl", "goldfish in a bowl", "hand_right"),
  c("butterfly-stick", "butterfly on a stick", "hand_right"),
  c("tiny-dragon", "tiny dragon", "hand_right"),
  c("pet-snake", "pet snake", "hand_right"),
  c("stuffed-bunny", "stuffed bunny", "hand_right"),

  // Scene props — sky
  p("sun", "sun", "sky_center"),
  p("full-moon", "full moon", "sky_center"),
  p("crescent-moon", "crescent moon", "sky_right"),
  p("single-star", "single star", "sky_right"),
  p("star-cluster", "cluster of stars", "sky_left"),
  p("cloud", "cloud", "sky_center"),
  p("rainbow", "rainbow", "sky_center"),
  p("lightning-bolt", "lightning bolt", "sky_center"),
  p("raindrop", "raindrop", "sky_center"),
  p("snowflake", "snowflake", "sky_center"),

  // Scene props — ground & nature
  p("mountain", "mountain", "ground_center"),
  p("pine-tree", "pine tree", "ground_center"),
  p("palm-tree", "palm tree", "ground_center"),
  p("giant-flower", "giant flower", "ground_center"),
  p("mushroom", "mushroom", "ground_center"),
  p("pumpkin", "pumpkin", "ground_center"),
  p("snowman", "snowman", "ground_center"),
  p("sand-castle", "sand castle", "ground_center"),
  p("beach-ball", "beach ball", "ground_center"),
  p("igloo", "igloo", "ground_center"),

  // Scene props — fantastical
  p("treasure-chest", "treasure chest", "ground_center"),
  p("hot-air-balloon", "hot air balloon", "far_back"),
  p("rocket-ship", "rocket ship", "ground_center"),
];
