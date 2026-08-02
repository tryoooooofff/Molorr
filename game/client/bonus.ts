export const BONUS_DURATION = 60 * 60; // one hour, in seconds
const BONUS_KEY = "petalia.bonus_data";

type BonusData = {
  last_claim_date: string | null;
  streak_days: number;
  total_claims: number;
  last_bonus_time: string | null;
  bonus_history: { date: string; multiplier: number; streak: number }[];
  saved_multiplier: number;
};

/**
 * Client-persisted daily loot bonus. The game already stores guest progress on
 * this device, so the bonus follows the same model and is re-sent when a match
 * starts. The simulation still owns the actual drop spawning and expiry.
 */
export class BonusSystem {
  private data: BonusData;
  private active = false;
  private multiplier = 1;
  private endsAt = 0;

  constructor() {
    this.data = this.load();
    this.restore();
  }

  private load(): BonusData {
    const defaults: BonusData = { last_claim_date: null, streak_days: 0, total_claims: 0, last_bonus_time: null, bonus_history: [], saved_multiplier: 1 };
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
  }

  private today() { return new Date().toISOString().slice(0, 10); }

  private restore() {
    if (!this.data.last_bonus_time) return;
    const started = new Date(this.data.last_bonus_time).getTime();
    const remaining = BONUS_DURATION - (Date.now() - started) / 1000;
    if (Number.isFinite(remaining) && remaining > 0) {
      this.active = true;
      this.multiplier = Math.max(2, this.data.saved_multiplier || 2);
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
      this.multiplier = 1;
      this.endsAt = 0;
      this.data.last_bonus_time = null;
      this.data.saved_multiplier = 1;
      this.save();
      return true;
    }
    return false;
  }

  canClaim() { return this.data.last_claim_date !== this.today(); }

  /** 2x for days 1–3, 4x every fourth consecutive day, otherwise 3x. */
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
    this.multiplier = this.nextMultiplier();
    this.active = true;
    this.endsAt = Date.now() + BONUS_DURATION * 1000;
    this.data.last_claim_date = today;
    this.data.last_bonus_time = new Date().toISOString();
    this.data.saved_multiplier = this.multiplier;
    this.data.total_claims++;
    this.data.bonus_history = [...this.data.bonus_history, { date: today, multiplier: this.multiplier, streak: this.data.streak_days }].slice(-30);
    this.save();
    return true;
  }

  get isActive() { this.update(); return this.active; }
  get currentMultiplier() { return this.isActive ? this.multiplier : 1; }
  get remainingSeconds() { return this.isActive ? Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000)) : 0; }
  get streakDays() { return this.data.streak_days; }
  get nextBonusMultiplier() { return this.nextMultiplier(this.data.last_claim_date === this.today() ? this.data.streak_days : 1); }
  get totalClaims() { return this.data.total_claims; }
  get remainingTimeText() {
    const seconds = this.remainingSeconds;
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
}
