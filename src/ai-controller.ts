import type { PuppetModel } from "./puppet-model";
import type { Action, Gaze } from "../server/protocol.ts";
import type { UserPuppetState, ViewSize } from "./user-controller";

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
 *   - rise animation on first appearance
 *   - resting side selection (opposite the user puppet)
 *   - brain-supplied gaze bias with exponential decay back to the user
 *   - dispatch of Action events from the server (emotion, gesture, gaze, say)
 */
export class AiPuppetController {
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

  update(
    dt: number,
    view: ViewSize,
    userState: { visible: boolean; state: Readonly<UserPuppetState> } | null,
  ): void {
    // Always on stage now that there's only one user puppet — rise
    // animates only on initial entry.
    this.rise += (1 - this.rise) * (1 - Math.exp(-dt / 0.28));
    this.model.root.visible = true;

    const settledY = -view.h * 0.1;
    const belowY = -view.h / 2 - 2.8; // offstage below the apron

    // Sit opposite the user puppet so they face each other on stage. With
    // no user visible, default to stage-right for consistency.
    if (userState && userState.visible) {
      const sideSign = Math.sign(userState.state.x) || -1;
      const targetX = -sideSign * view.w * 0.22;
      this.settledX += (targetX - this.settledX) * (1 - Math.exp(-dt / 0.25));
    } else {
      const targetX = -view.w * 0.22;
      this.settledX += (targetX - this.settledX) * (1 - Math.exp(-dt / 0.25));
    }

    const root = this.model.root;
    root.position.x = this.settledX;
    root.position.y = belowY + (settledY - belowY) * this.rise;
    root.position.z = this.opts.puppetZ;
    root.scale.setScalar(0.9 * this.opts.depthScale);

    // Glance toward the user puppet if visible, blended with the most
    // recent brain-supplied gaze bias.
    const puppetGlance =
      userState && userState.visible
        ? Math.max(-1, Math.min(1, (userState.state.x - root.position.x) * 0.3))
        : 0;
    this.brainGazeWeight *= Math.exp(-dt / 1.2);
    const glanceX = this.brainGazeX * this.brainGazeWeight + puppetGlance * (1 - this.brainGazeWeight);
    const glanceY = this.brainGazeY * this.brainGazeWeight;
    this.model.setGaze(glanceX, glanceY);
    this.model.update(dt);
  }
}
