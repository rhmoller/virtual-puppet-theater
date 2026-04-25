import type { PuppetModel } from "./puppet-model";
import type { Action, Gaze } from "../server/protocol.ts";
import type { HandLabel, UserPuppetState, ViewSize } from "./user-controller";

const GAZE_TO_BIAS: Record<Gaze, { x: number; y: number }> = {
  user: { x: 0, y: 0 },
  away: { x: -0.9, y: 0 },
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
};

export type AiControllerOpts = {
  puppetZ: number;
  depthScale: number;
  /** Hook the controller fires when an Action contains a `say`. */
  speak: (text: string) => void;
};

/**
 * Drives the AI-controlled stage puppet. Owns:
 *   - rise/sink animation (cedes the stage when the user shows a second hand)
 *   - resting side selection (opposite the active user puppet)
 *   - brain-supplied gaze bias with exponential decay back to the user
 *   - dispatch of Action events from the server (emotion, gesture, gaze, say)
 */
export class AiPuppetController {
  private side: HandLabel | null = null;
  private rise = 0;          // 0 = fully below the stage, 1 = fully risen
  private settledX = 0;
  // Brain-driven gaze bias: set by an incoming action, decays back to 0.
  private brainGazeX = 0;
  private brainGazeY = 0;
  private brainGazeWeight = 0;

  constructor(
    public readonly model: PuppetModel,
    private readonly opts: AiControllerOpts,
  ) {}

  applyAction(action: Action): void {
    if (action.gaze) {
      const bias = GAZE_TO_BIAS[action.gaze];
      this.brainGazeX = bias.x;
      this.brainGazeY = bias.y;
      this.brainGazeWeight = 1;
    }
    if (action.emotion) this.model.setEmotion(action.emotion);
    if (action.gesture) this.model.playGesture(action.gesture);
    if (action.say) this.opts.speak(action.say);
  }

  update(dt: number, view: ViewSize, userStates: ReadonlyArray<{ visible: boolean; state: Readonly<UserPuppetState>; hand: HandLabel }>): void {
    const leftPresent = userStates.some((u) => u.hand === "Left" && u.visible);
    const rightPresent = userStates.some((u) => u.hand === "Right" && u.visible);
    const count = (leftPresent ? 1 : 0) + (rightPresent ? 1 : 0);

    // The stage puppet stays on stage unless the user brings up a second
    // hand — then it cedes the stage so both human puppets have room.
    const riseTarget = count >= 2 ? 0 : 1;
    const tau = riseTarget > this.rise ? 0.28 : 0.18; // slightly faster on descent
    this.rise += (riseTarget - this.rise) * (1 - Math.exp(-dt / tau));

    if (riseTarget === 0 && this.rise < 0.005) {
      this.model.root.visible = false;
      this.side = null;
      return;
    }
    this.model.root.visible = true;

    const settledY = -view.h * 0.1;
    const belowY = -view.h / 2 - 2.8; // offstage below the apron

    // Pick the stage puppet's resting side based on where the human puppet
    // is (if any). With no hands up, default to stage-right for consistency.
    if (count === 1) {
      this.side = leftPresent ? "Right" : "Left";
      const active = userStates.find(
        (u) => (u.hand === "Left" && leftPresent) || (u.hand === "Right" && rightPresent),
      );
      const sideSign = active ? Math.sign(active.state.x) || (this.side === "Right" ? 1 : -1) : 0;
      const targetX = -sideSign * view.w * 0.22;
      this.settledX += (targetX - this.settledX) * (1 - Math.exp(-dt / 0.25));
    } else if (count === 0) {
      if (this.side === null) this.side = "Right";
      const targetX = (this.side === "Right" ? -1 : 1) * view.w * 0.22;
      this.settledX += (targetX - this.settledX) * (1 - Math.exp(-dt / 0.25));
    }

    const root = this.model.root;
    root.position.x = this.settledX;
    root.position.y = belowY + (settledY - belowY) * this.rise;
    root.position.z = this.opts.puppetZ;
    root.scale.setScalar(0.65 * this.opts.depthScale);

    // Glance toward the currently visible user puppet (if any), blended
    // with the most recent brain-supplied gaze bias.
    const active = userStates.find((u) => u.visible);
    const puppetGlance = active
      ? Math.max(-1, Math.min(1, (active.state.x - root.position.x) * 0.3))
      : 0;
    this.brainGazeWeight *= Math.exp(-dt / 1.2);
    const glanceX = this.brainGazeX * this.brainGazeWeight + puppetGlance * (1 - this.brainGazeWeight);
    const glanceY = this.brainGazeY * this.brainGazeWeight;
    this.model.setGaze(glanceX, glanceY);
    this.model.update(dt);
  }
}
