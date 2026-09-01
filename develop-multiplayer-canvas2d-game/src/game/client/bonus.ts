import { CloudStorage } from "./storage";

export const BONUS_DURATION = 60 * 60; // one hour, in seconds
const BONUS_KEY = "petalia.bonus_data";
/** Base multiplier of the Extra Bonus window (the membership buff is added on top). */
const EXTRA_BONUS_BASE = 3;

type BonusData = {
  last_claim_date: string | null;
  streak_days: number;
  total_claims: number;
  last_bonus_time: string | null;
  bonus_history: { date: string; multiplier: number; streak: number; extra?: boolean }[];
  saved_multiplier: number;
  extra_claim_date: string | null;
};

/**
 * Client-persisted daily loot bonus. The game already stores guest progress on
 * this device, so the bonus follows the same model and is re-sent when a match
 * starts. The simulation still owns the actual drop spawning and expiry.
 *
 * Membership integration:
 *  - `setMembershipBuff(n)` (Diamond +1, Ruby +2) stacks on TOP of the window
 *    multiplier: daily streak 2x/3x/4x becomes 3x/4x/5x (Diamond) or
 *    4x/5x/6x (Ruby); the Extra Bonus base 3x becomes 4x/5x.
 *  - `setExtraBonusAvailable(true)` (Ruby only) unlocks a SEPARATE "Extra
 *    Bonus" claim: once per day, its own 1-hour window at 3x + buff.
 *
 * `saved_multiplier` always stores the BASE of the running window; the buff is
 * applied live so mid-window membership changes are reflected without
 * double-counting.
 */
export class BonusSystem {
  private data: BonusData;
  private active = false;
  private endsAt = 0;
  /** Membership buff (Diamond +1, Ruby +2) added on top of the window multiplier. */
  private _membershipBuff = 0;
  /** Ruby "Extra Bonus" perk: true while a membership granting it is active. */
  private _extraAvailable = false;

  constructor() {
    this.data = this.load();
    this.restore();
  }

  private load(): BonusData {
    const defaults: BonusData = { last_claim_date: null, streak_days: 0, total_claims: 0, last_bonus_time: null, bonus_history: [], saved_multiplier: 1, extra_claim_date: null };
    try {
      const saved = localStorage.getItem(BONUS_KEY);
      if (!saved) return defaults;
      return { ...defaults, ...JSON.parse(saved) };
    } catch {
      return defaults;
    }
  }

  private save() {
    try { localStorage.setItem(BONUS_KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
    // Sync to cloud storage
    if (CloudStorage.isReady) {
      CloudStorage.instance.set(BONUS_KEY, this.data);
    }
  }

  private today() { return new Date().toISOString().slice(0, 10); }

  private restore() {
    if (!this.data.last_bonus_time) return;
    const started = new Date(this.data.last_bonus_time).getTime();
    const remaining = BONUS_DURATION - (Date.now() - started) / 1000;
    if (Number.isFinite(remaining) && remaining > 0) {
      this.active = true;
      this.endsAt = Date.now() + remaining * 1000;
    } else {
      this.data.last_bonus_time = null;
      this.data.saved_multiplier = 1;
      this.save();
    }
  }

  update() {
    if (this.active && this.endsAt <= Date.now()) {
      this.active = false;
      this.endsAt = 0;
      this.data.last_bonus_time = null;
      this.data.saved_multiplier = 1;
      this.save();
      return true;
    }
    return false;
  }

  canClaim() { return this.data.last_claim_date !== this.today(); }

  // ----------------------------------------------------------------- membership

  /**
   * Membership buff (Diamond +1, Ruby +2). Stacks on top of whichever
   * multiplier the running window would have (daily streak 2x/3x/4x or the
   * Extra Bonus base 3x). No-op when unchanged.
   */
  setMembershipBuff(n: number) {
    const buff = Math.max(0, Math.min(2, Math.floor(n) || 0));
    if (buff === this._membershipBuff) return;
    this._membershipBuff = buff;
  }

  get membershipBuff() { return this._membershipBuff; }

  /** Ruby "Extra Bonus" perk — set by the shop while the membership is valid. */
  setExtraBonusAvailable(v: boolean) {
    this._extraAvailable = !!v;
  }

  get extraAvailable() { return this._extraAvailable; }

  /** Multiplier of the Extra Bonus window: fixed base 3x + membership buff (3x–5x). */
  get extraMultiplier() { return EXTRA_BONUS_BASE + this._membershipBuff; }

  /**
   * Extra Bonus claim rules (independent of the daily streak claim):
   *  - only while the Ruby membership is active,
   *  - once per day,
   *  - only when no bonus window is currently running.
   */
  get canClaimExtra() {
    return this.extraAvailable && !this.active && this.data.extra_claim_date !== this.today();
  }

  get extraClaimedToday() { return this.data.extra_claim_date === this.today(); }

  claimExtra() {
    this.update();
    if (!this.canClaimExtra) return false;
    this.active = true;
    this.endsAt = Date.now() + BONUS_DURATION * 1000;
    this.data.extra_claim_date = this.today();
    this.data.last_bonus_time = new Date().toISOString();
    // Store the base only; the membership buff is applied live (see currentMultiplier).
    this.data.saved_multiplier = EXTRA_BONUS_BASE;
    this.data.bonus_history = [...this.data.bonus_history, { date: this.today(), multiplier: this.currentMultiplier, streak: this.data.streak_days, extra: true }].slice(-30);
    this.save();
    return true;
  }

  // ---------------------------------------------------------------------- daily

  /** Base daily multiplier by streak: 2x for days 1–3, 4x every fourth consecutive day, otherwise 3x. The membership buff is applied on top. */
  private nextMultiplier(streak = this.data.streak_days) {
    if (streak <= 3) return 2;
    return streak % 4 === 0 ? 4 : 3;
  }

  claim() {
    this.update();
    if (!this.canClaim() || this.active) return false;
    const today = this.today();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    this.data.streak_days = this.data.last_claim_date === yesterday ? this.data.streak_days + 1 : 1;
    // Store the BASE streak multiplier; the membership buff is applied live so
    // mid-window membership changes are reflected without double-counting.
    this.data.saved_multiplier = this.nextMultiplier();
    this.active = true;
    this.endsAt = Date.now() + BONUS_DURATION * 1000;
    this.data.last_claim_date = today;
    this.data.last_bonus_time = new Date().toISOString();
    this.data.total_claims++;
    this.data.bonus_history = [...this.data.bonus_history, { date: today, multiplier: this.currentMultiplier, streak: this.data.streak_days }].slice(-30);
    this.save();
    return true;
  }

  get isActive() { this.update(); return this.active; }
  /** Live multiplier of the running window: stored base + current membership buff. */
  get currentMultiplier() { return this.isActive ? Math.max(2, this.data.saved_multiplier || 2) + this._membershipBuff : 1; }
  get remainingSeconds() { return this.isActive ? Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000)) : 0; }
  get streakDays() { return this.data.streak_days; }
  get nextBonusMultiplier() { return this.nextMultiplier(this.data.last_claim_date === this.today() ? this.data.streak_days : 1) + this._membershipBuff; }
  get totalClaims() { return this.data.total_claims; }
  get remainingTimeText() {
    const seconds = this.remainingSeconds;
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
}
