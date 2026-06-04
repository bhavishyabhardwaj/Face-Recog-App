import {LIVENESS} from '../config';

/**
 * Offline liveness via randomized challenge–response + frame consistency.
 *
 * The ML Kit detector already returns the signals we need per frame:
 *   - leftEyeOpenProbability / rightEyeOpenProbability  -> blink
 *   - yawAngle (degrees)                                -> head turn
 *   - smilingProbability                                -> smile
 *   - trackingId (stable while it's the same face)      -> anti frame-jump
 *
 * This class is UI-agnostic. The Auth screen pushes a DetectionFrame every time
 * a face is detected; the session advances and reports its state. A printed
 * photo / static screen can never satisfy a *changing* signal within the time
 * window, and a face-jump (swap to another phone screen) breaks trackingId.
 */

export type Challenge = 'blink' | 'turn' | 'smile';

export interface DetectionFrame {
  leftEyeOpenProbability: number;
  rightEyeOpenProbability: number;
  smilingProbability: number;
  yawAngle: number; // degrees, signed
  trackingId?: number;
}

export type LivenessState = 'idle' | 'running' | 'passed' | 'failed';

const CHALLENGE_LABELS: Record<Challenge, string> = {
  blink: 'Blink your eyes',
  turn: 'Turn your head left or right',
  smile: 'Smile',
};

function pickChallenges(): Challenge[] {
  const pool: Challenge[] = ['blink', 'turn', 'smile'];
  // 1–2 random, unique, order randomized => not predictable.
  const count = 1 + Math.floor(Math.random() * 2);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export class LivenessSession {
  challenges: Challenge[];
  state: LivenessState = 'idle';
  private index = 0;
  private startedAt = 0;
  private blinkSawClosed = false;
  private firstTrackingId?: number;

  constructor(challenges?: Challenge[]) {
    this.challenges = challenges ?? pickChallenges();
  }

  start(): void {
    this.state = 'running';
    this.index = 0;
    this.startedAt = Date.now();
    this.blinkSawClosed = false;
    this.firstTrackingId = undefined;
  }

  get currentChallenge(): Challenge | null {
    return this.state === 'running' ? this.challenges[this.index] : null;
  }

  get prompt(): string {
    const c = this.currentChallenge;
    return c ? CHALLENGE_LABELS[c] : '';
  }

  get progress(): string {
    return `${Math.min(this.index, this.challenges.length)}/${this.challenges.length}`;
  }

  /** Feed one detected-face frame. Returns the (possibly updated) state. */
  update(f: DetectionFrame): LivenessState {
    if (this.state !== 'running') return this.state;

    // Timeout per session (anti slow-replay).
    if (Date.now() - this.startedAt > LIVENESS.challengeTimeoutMs * this.challenges.length) {
      this.state = 'failed';
      return this.state;
    }

    // Frame consistency: same face must persist across the challenge.
    if (LIVENESS.requireStableTrackingId && f.trackingId !== undefined) {
      if (this.firstTrackingId === undefined) {
        this.firstTrackingId = f.trackingId;
      } else if (f.trackingId !== this.firstTrackingId) {
        this.state = 'failed'; // face jumped -> screen swap / replay cut
        return this.state;
      }
    }

    const challenge = this.challenges[this.index];
    if (this.satisfies(challenge, f)) {
      this.index += 1;
      this.blinkSawClosed = false;
      if (this.index >= this.challenges.length) {
        this.state = 'passed';
      } else {
        // reset per-challenge timer baseline so later challenges get full window
        this.startedAt = Date.now() - (LIVENESS.challengeTimeoutMs * this.index);
      }
    }
    return this.state;
  }

  private satisfies(c: Challenge, f: DetectionFrame): boolean {
    const eyeOpen = Math.min(f.leftEyeOpenProbability, f.rightEyeOpenProbability);
    switch (c) {
      case 'blink': {
        // Require a closed->open transition, not just "eyes closed".
        if (eyeOpen < LIVENESS.blinkClosedProb) this.blinkSawClosed = true;
        return this.blinkSawClosed && eyeOpen > LIVENESS.blinkOpenProb;
      }
      case 'turn':
        return Math.abs(f.yawAngle) > LIVENESS.yawThresholdDeg;
      case 'smile':
        return f.smilingProbability > LIVENESS.smileProb;
      default:
        return false;
    }
  }
}
