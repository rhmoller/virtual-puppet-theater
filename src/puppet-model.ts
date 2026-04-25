import type * as THREE from "three";
import type { Emotion, Gesture } from "../server/protocol.ts";

/**
 * Shared interface for any puppet rig. Both the hand-driven user
 * puppet (src/puppet.ts) and the AI-driven stage puppet
 * (src/puppet-stage.ts) implement this so that controllers can drive
 * either kind without caring which animator is wired up.
 *
 * Methods that don't map to a given model are no-ops on that model —
 * call sites don't need to branch. The user puppet's mouth is
 * hand-controlled, so its setSpeaking is a no-op; the AI puppet's
 * mouth is TTS-driven, so its setOpen is a no-op. Same shape, same
 * call pattern.
 */
export interface PuppetModel {
  readonly root: THREE.Group;

  /** Open the mouth/jaw 0..1. Hand-driven on user puppets, no-op on AI. */
  setOpen(amount: number): void;
  /** Aim the head/eyes toward a normalized 2D direction. */
  setGaze(gx: number, gy: number): void;
  /** Roll the puppet around its forward axis (radians). */
  setRoll(rad: number): void;
  /** Persistent emotional bias. No-op on user puppet. */
  setEmotion(emotion: Emotion): void;
  /** One-shot gesture clip. No-op on user puppet. */
  playGesture(gesture: Gesture): void;
  /** Toggle the speaking lip-sync layer. No-op on user puppet. */
  setSpeaking(on: boolean): void;
  /** Per-frame tick. Gaze is supplied via setGaze, not as a tick arg. */
  update(dt: number): void;
}
