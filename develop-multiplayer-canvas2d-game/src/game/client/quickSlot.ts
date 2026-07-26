/**
 * QuickSlot — dual-row hotbar with main slots + secondary slots.
 *
 * Main row    : larger (55px), primary combat petals.
 * Secondary row : smaller (42px), backup / utility items.
 *
 * Hotkeys:
 *   r        — swap all main ↔ secondary slots at once.
 *   1 – 9    — swap a single slot (main ↔ secondary) by index.
 *
 * Mimic items are tracked but petals rendered on the flower ignore mimic state
 * (per the "ignore mimic part" requirement).  The tracker is only used for
 * display / tooltip purposes inside the quick-slot bars.
 */

import { RARITY_ORDER } from "../shared/defs";
import type { Cell } from "../shared/sim";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MimicRecord {
  originalData: {
    type: string;
    rarity: number;
    level: number;
    durability?: number;
    maxDurability?: number;
    reloadTime?: number;
    baseReloadTime?: number;
    armor?: number;
    isBroken?: boolean;
  };
  displayType: string;
  isMain: boolean;
  slotIndex: number;
}

// ---------------------------------------------------------------------------
// QuickSlot
// ---------------------------------------------------------------------------

export class QuickSlot {
  player: any; // Player reference — duck-typed to work with petal system
  slots: (Cell | null)[] = [];
  secondarySlots: (Cell | null)[] = [];
  baseSlotCount = 10;

  selectedIndex = 0;
  mouseX = 0;
  mouseY = 0;

  // Sizing
  SLOT_SIZE = 55;
  SLOT_SPACING = 6;
  SECONDARY_SLOT_SIZE = 42;
  SECONDARY_SLOT_SPACING = 4;
  SECONDARY_OFFSET_Y = 60;
  SECONDARY_OFFSET_X = 50;

  // Mimic tracker — kept for display purposes only; petals ignore mimic state
  mimicTracker = new Map<string, MimicRecord>();

  constructor(player: any) {
    this.player = player;
    this.updateSlotCount();
  }

  // -----------------------------------------------------------------------
  // Canvas helpers
  // -----------------------------------------------------------------------

  _canvasW(): number {
    return (window as any).WIDTH || window.innerWidth || 800;
  }

  _canvasH(): number {
    return (window as any).HEIGHT || window.innerHeight || 600;
  }

  // -----------------------------------------------------------------------
  // Layout (shared by draw + click)
  // -----------------------------------------------------------------------

  _layout() {
    const W = this._canvasW();
    const H = this._canvasH();
    const n = this.slots.length;

    const totalW = n * this.SLOT_SIZE + (n - 1) * this.SLOT_SPACING;
    const startX = Math.floor(W / 2 - totalW / 2);
    const startY = H - 120;

    const secSize = this.SECONDARY_SLOT_SIZE;
    const secSpacing = this.SECONDARY_SLOT_SPACING;
    const secTotalW = n * secSize + (n - 1) * secSpacing;
    const secStartX = Math.floor(W / 2 - secTotalW / 2);
    const secStartY = startY + this.SECONDARY_OFFSET_Y;

    return { n, startX, startY, secStartX, secStartY, secSize, secSpacing };
  }

  // -----------------------------------------------------------------------
  // Redraw request
  // -----------------------------------------------------------------------

  _requestRedraw() {
    // Try game-instance path first
    if (this.player?.gameInstance?.requestRedraw) {
      this.player.gameInstance.requestRedraw();
      return;
    }
    // Fallback: redraw via main menu canvas
    const gi = (window as any).gameInstance;
    const mm = gi?.mainMenu;
    if (mm) {
      const canvas =
        document.getElementById("gameCanvas") || gi?.screen;
      if (canvas?.getContext) {
        requestAnimationFrame(() => mm.draw(canvas.getContext("2d")));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Save / Load
  // -----------------------------------------------------------------------

  _saveSlots() {
    try {
      const slotData = (this.slots || []).map((item, i) =>
        item
          ? {
              slot_index: i,
              type: item.type,
              rarity: item.rarity,
              level: (item as any).level || 1,
              count: (item as any).count || 1,
              durability: (item as any).durability,
              maxDurability: (item as any).maxDurability,
            }
          : null,
      ).filter(Boolean);

      // Persist via localStorage
      try {
        const existing = JSON.parse(localStorage.getItem("game_save") || "{}");
        existing.quick_slot = slotData;
        localStorage.setItem("game_save", JSON.stringify(existing));
      } catch {
        /* storage full */
      }

      const gi = (window as any).gameInstance;
      if (!gi) return;
      const gameData = {
        score: gi.score || 0,
        enemiesKilled: gi.enemiesKilled || 0,
        currentWave: gi.currentWave || 1,
      };

      // autoSaveSystem
      const mm = gi.mainMenu;
      if (mm?.autoSaveSystem?.saveGame) {
        mm.autoSaveSystem.saveGame(this.player, gameData);
      }
      // Account cloud save
      if (
        gi.accountSystem?.isLoggedIn?.() &&
        gi.accountSystem?.saveGameData
      ) {
        gi.accountSystem.saveGameData(this.player, gameData);
      }
    } catch (e) {
      console.error("QuickSlot _saveSlots failed:", e);
    }
  }

  restoreSecondarySlots(saveData: any) {
    if (!saveData?.secondary_slot) return;
    const target = this.getCurrentSlotCount();
    this.secondarySlots = new Array(target).fill(null);
    for (const s of saveData.secondary_slot) {
      if (s.slot_index == null || s.slot_index >= target) continue;
      try {
        // Re-construct item via global constructors (Item / DNA)
        const gi = (window as any).gameInstance;
        let item: any;
        if (s.type === "DNA" && gi?.DNA) {
          item = new (gi.DNA)(s.rarity, parseInt(s.level) || 1);
        } else if (gi?.Item) {
          item = new (gi.Item)(s.type, parseInt(s.level) || 1, s.rarity);
        } else {
          // Fallback: plain object
          item = {
            type: s.type,
            rarity: s.rarity,
            level: parseInt(s.level) || 1,
            count: s.count || 1,
          };
        }
        item.count = s.count || 1;
        this.secondarySlots[s.slot_index] = item;
      } catch (e) {
        console.error("恢复副栏物品失败:", e);
      }
    }
    console.log(
      `✅ 恢复了 ${saveData.secondary_slot.length} 个副栏物品，目标槽位数: ${target}`,
    );
  }

  // -----------------------------------------------------------------------
  // Slot count management
  // -----------------------------------------------------------------------

  getCurrentSlotCount(): number {
    if (!this.player || !this.player.getTotalSlotCount) return 5;
    return this.player.getTotalSlotCount();
  }

  updateSlotCount() {
    const target = this.getCurrentSlotCount();
    if (!this.slots || this.slots.length !== target) {
      const old = this.slots || new Array(this.baseSlotCount).fill(null);
      const next = new Array(target).fill(null);
      for (let i = 0; i < Math.min(old.length, target); i++) next[i] = old[i];
      this.slots = next;
    }
    if (!this.secondarySlots || this.secondarySlots.length !== target) {
      const old =
        this.secondarySlots || new Array(this.baseSlotCount).fill(null);
      const next = new Array(target).fill(null);
      for (let i = 0; i < Math.min(old.length, target); i++) next[i] = old[i];
      this.secondarySlots = next;
    }
  }

  // -----------------------------------------------------------------------
  // Swap (hotkey: 'r' = all, '1'-'9' = single)
  // -----------------------------------------------------------------------

  swapSlot(slotIndex: number) {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;

    // Move mimic tracking between rows
    let mainMimicData: MimicRecord | null = null;
    let secondaryMimicData: MimicRecord | null = null;

    if (this.mimicTracker.has(`main_${slotIndex}`)) {
      mainMimicData = this.mimicTracker.get(`main_${slotIndex}`) || null;
      this.mimicTracker.delete(`main_${slotIndex}`);
    }
    if (this.mimicTracker.has(`sec_${slotIndex}`)) {
      secondaryMimicData = this.mimicTracker.get(`sec_${slotIndex}`) || null;
      this.mimicTracker.delete(`sec_${slotIndex}`);
    }

    const tmp = this.slots[slotIndex];
    this.slots[slotIndex] = this.secondarySlots[slotIndex];
    this.secondarySlots[slotIndex] = tmp;

    if (mainMimicData) {
      this.mimicTracker.set(`sec_${slotIndex}`, {
        ...mainMimicData,
        isMain: false,
        slotIndex,
      });
    }
    if (secondaryMimicData) {
      this.mimicTracker.set(`main_${slotIndex}`, {
        ...secondaryMimicData,
        isMain: true,
        slotIndex,
      });
    }

    // Clear summons from the old petal so the new one comes in clean
    if (this.player?.petals) {
      const p = this.player.petals.find(
        (p: any) => p && p._petalIndex === slotIndex,
      );
      if (p?._clearAllSummons) {
        p._clearAllSummons();
        p.eggSpawned = false;
      }
    }

    this.updatePetalFromSlot(slotIndex);
    this._forceReloadPetal(slotIndex);
    this._saveSlots();
    this._requestRedraw();
    console.log(`🔄 交换槽位 ${slotIndex}: 主栏 ↔ 副栏`);
  }

  swapAllSlots() {
    const allMimics: { key: string; data: MimicRecord }[] = [];
    for (const [key, data] of this.mimicTracker.entries()) {
      allMimics.push({ key, data });
      this.mimicTracker.delete(key);
    }

    // Clear summons before the swap
    if (this.player?.petals) {
      for (const p of this.player.petals) {
        if (p?._clearAllSummons) {
          p._clearAllSummons();
          p.eggSpawned = false;
        }
      }
    }

    for (let i = 0; i < this.slots.length; i++) {
      const tmp = this.slots[i];
      this.slots[i] = this.secondarySlots[i];
      this.secondarySlots[i] = tmp;
      this.updatePetalFromSlot(i);
    }

    for (const { key, data } of allMimics) {
      const [type, idx] = key.split("_");
      const newType = type === "main" ? "sec" : "main";
      this.mimicTracker.set(`${newType}_${idx}`, {
        ...data,
        isMain: newType === "main",
        slotIndex: parseInt(idx),
      });
    }

    for (let i = 0; i < this.slots.length; i++) this._forceReloadPetal(i);
    this._saveSlots();
    this._requestRedraw();
    console.log("🔄 交换所有主副栏槽位完成");
  }

  // -----------------------------------------------------------------------
  // Petal reload helpers
  // -----------------------------------------------------------------------

  _forceReloadPetal(slotIndex: number) {
    if (!this.player?.petals || !this.slots[slotIndex]) return;
    const petal = this.player.petals.find(
      (p: any) => p && p.petalIndex === slotIndex,
    );
    if (!petal) return;
    if (typeof petal.startReload === "function") {
      petal.startReload();
    } else if (petal.reloadTime !== undefined) {
      petal.isReloading = true;
      petal.reloadCooldown =
        petal.reloadTime ?? petal.attackCooldownMax ?? 1000;
    }
  }

  // -----------------------------------------------------------------------
  // Item management
  // -----------------------------------------------------------------------

  addItem(item: any, slotIndex: number): boolean {
    if (slotIndex >= 0 && slotIndex < this.slots.length) {
      // Ignore mimic state for petals — strip mimic metadata on add
      if (item && item.type !== "Mimic") {
        item._originalMimicData = null;
        item._isMimic = false;
        item._isTransformedMimic = false;
        item._mimicDisplayType = null;
      }

      // Main slot free → place there
      if (this.slots[slotIndex] === null) {
        this.slots[slotIndex] = item;
        this.unregisterMimic(slotIndex, true);
        this.updatePetalFromSlot(slotIndex);
        this._triggerMimicIfNeeded(item, slotIndex);
        this._saveSlots();
        this._requestRedraw();
        return true;
      }

      // Stackable
      if (
        this.slots[slotIndex]?.canStackWith?.(item) &&
        item.type !== "Mimic"
      ) {
        this.slots[slotIndex]!.count += item.count;
        this._saveSlots();
        this._requestRedraw();
        return true;
      }

      // Secondary slot free → place there
      if (this.secondarySlots[slotIndex] === null) {
        this.secondarySlots[slotIndex] = item;
        console.log(`📦 主栏槽位 ${slotIndex} 已满，放入副栏`);
        this._saveSlots();
        this._requestRedraw();
        return true;
      }

      // Secondary stackable
      if (
        this.secondarySlots[slotIndex]?.canStackWith?.(item) &&
        item.type !== "Mimic"
      ) {
        this.secondarySlots[slotIndex]!.count += item.count;
        this._saveSlots();
        this._requestRedraw();
        return true;
      }

      // Force-place into main slot
      this.slots[slotIndex] = item;
      this.updatePetalFromSlot(slotIndex);
      this._triggerMimicIfNeeded(item, slotIndex);
      this._saveSlots();
      this._requestRedraw();
      return true;
    }
    return false;
  }

  addItemAuto(item: any): boolean {
    // Strip mimic state
    if (item && item.type !== "Mimic") {
      item._originalMimicData = null;
      item._isMimic = false;
      item._isTransformedMimic = false;
      item._mimicDisplayType = null;
    }

    // Try main slots first
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i] === null) {
        this.slots[i] = item;
        this.updatePetalFromSlot(i);
        this._triggerMimicIfNeeded(item, i);
        this._saveSlots();
        this._requestRedraw();
        return true;
      }
      if (this.slots[i]!.canStackWith?.(item) && item.type !== "Mimic") {
        this.slots[i]!.count += item.count;
        this._saveSlots();
        this._requestRedraw();
        return true;
      }
    }

    // Then secondary slots
    for (let i = 0; i < this.secondarySlots.length; i++) {
      if (this.secondarySlots[i] === null) {
        this.secondarySlots[i] = item;
        console.log(`📦 主栏已满，物品放入副栏槽位 ${i}`);
        this._saveSlots();
        this._requestRedraw();
        return true;
      }
      if (
        this.secondarySlots[i]?.canStackWith?.(item) &&
        item.type !== "Mimic"
      ) {
        this.secondarySlots[i]!.count += item.count;
        this._saveSlots();
        this._requestRedraw();
        return true;
      }
    }

    return false;
  }

  removeItem(slotIndex: number): any | null {
    if (
      slotIndex >= 0 &&
      slotIndex < this.slots.length &&
      this.slots[slotIndex]
    ) {
      const item = this.slots[slotIndex];
      const petal = this.player?.petals?.[slotIndex];

      // Clear summons
      if (petal?._clearAllSummons) {
        petal._clearAllSummons();
        petal.eggSpawned = false;
      }

      // Restore mimic data on the item (not used by petal)
      if (item && item.type !== "Mimic" && item._originalMimicData) {
        const od = item._originalMimicData;
        item.type = od.type;
        item.rarity = od.rarity;
        item.level = od.level;
        item.durability = od.durability;
        item.maxDurability = od.maxDurability;
        item.reloadTime = od.reloadTime;
        item.baseReloadTime = od.baseReloadTime;
        item.armor = od.armor;
        petal?.updateFromQuickSlot?.(slotIndex);
      }

      if (item) {
        item._originalMimicData = null;
        item._isMimic = null;
        item._isTransformedMimic = false;
        item._mimicDisplayType = null;
      }
      // Petal ignores mimic — reset any mimic state on the petal
      if (petal) {
        petal.originalMimicData = null;
        petal._isActiveMimic = null;
        petal._isTransformedMimic = false;
        petal._mimicDisplayType = null;
      }

      this.slots[slotIndex] = null;
      this.resetPetalFromSlot(slotIndex);
      this.unregisterMimic(slotIndex, true);
      this._saveSlots();
      this._requestRedraw();
      return item;
    }
    return null;
  }

  removeSecondaryItem(slotIndex: number): any | null {
    if (
      slotIndex >= 0 &&
      slotIndex < this.secondarySlots.length &&
      this.secondarySlots[slotIndex]
    ) {
      const item = this.secondarySlots[slotIndex];
      this.secondarySlots[slotIndex] = null;
      this._saveSlots();
      return item;
    }
    return null;
  }

  consumeItem(slotIndex: number) {
    const item = this.slots[slotIndex];
    if (!item) return;
    if (item.count > 1) {
      item.count -= 1;
      this.updatePetalFromSlot(slotIndex);
    } else {
      this.slots[slotIndex] = null;
      this.resetPetalFromSlot(slotIndex);
    }
    this._saveSlots();
    this._requestRedraw();
  }

  // -----------------------------------------------------------------------
  // Mimic tracker — kept for display only; petals ignore mimic
  // -----------------------------------------------------------------------

  registerMimic(
    slotIndex: number,
    isMain: boolean,
    originalData: any,
    displayType: string,
  ) {
    const key = `${isMain ? "main" : "sec"}_${slotIndex}`;
    this.mimicTracker.set(key, {
      originalData: { ...originalData },
      displayType,
      isMain,
      slotIndex,
    });
    console.log(`📝 注册 Mimic: ${key}, 显示为: ${displayType}`);
  }

  unregisterMimic(slotIndex: number, isMain: boolean): boolean {
    const key = `${isMain ? "main" : "sec"}_${slotIndex}`;
    const existed = this.mimicTracker.has(key);
    this.mimicTracker.delete(key);
    return existed;
  }

  moveMimic(
    fromSlot: number,
    fromIsMain: boolean,
    toSlot: number,
    toIsMain: boolean,
  ): boolean {
    const fromKey = `${fromIsMain ? "main" : "sec"}_${fromSlot}`;
    if (!this.mimicTracker.has(fromKey)) return false;
    const data = this.mimicTracker.get(fromKey)!;
    this.mimicTracker.delete(fromKey);
    this.mimicTracker.set(`${toIsMain ? "main" : "sec"}_${toSlot}`, {
      ...data,
      slotIndex: toSlot,
      isMain: toIsMain,
    });
    return true;
  }

  getMimicData(slotIndex: number, isMain: boolean): MimicRecord | null {
    return (
      this.mimicTracker.get(`${isMain ? "main" : "sec"}_${slotIndex}`) || null
    );
  }

  restoreAllMimics(): string[] {
    const restored: string[] = [];
    for (const [key, data] of this.mimicTracker.entries()) {
      const [type, sidx] = key.split("_");
      const isMain = type === "main";
      const idx = parseInt(sidx);
      const item = isMain ? this.slots[idx] : this.secondarySlots[idx];
      if (
        item &&
        data.originalData?.type === "Mimic" &&
        item.type !== "Mimic"
      ) {
        item.type = data.originalData.type;
        item.rarity = data.originalData.rarity;
        item.level = data.originalData.level;
        item.durability = data.originalData.durability;
        item.maxDurability = data.originalData.maxDurability;
        item.reloadTime = data.originalData.reloadTime;
        item.baseReloadTime = data.originalData.baseReloadTime;
        item.armor = data.originalData.armor;
        item.isBroken = data.originalData.isBroken || false;
        restored.push(key);
      }
      if (item) {
        item._originalMimicData = null;
        item._isTransformedMimic = false;
        item._mimicDisplayType = null;
      }
    }
    this.mimicTracker.clear();
    for (let i = 0; i < this.slots.length; i++) this.updatePetalFromSlot(i);
    console.log(`✅ 共恢复 ${restored.length} 个 Mimic`);
    return restored;
  }

  _triggerMimicIfNeeded(item: any, slotIndex: number) {
    if (item?.type === "Mimic" && this.player) {
      const petal = this.player.petals?.[slotIndex];
      if (petal?.autoCopyWithMimic) {
        setTimeout(() => petal.autoCopyWithMimic(slotIndex), 100);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Item queries
  // -----------------------------------------------------------------------

  getItem(slotIndex: number): any | null {
    return slotIndex >= 0 && slotIndex < this.slots.length
      ? this.slots[slotIndex]
      : null;
  }

  getSecondaryItem(slotIndex: number): any | null {
    return slotIndex >= 0 && slotIndex < this.secondarySlots.length
      ? this.secondarySlots[slotIndex]
      : null;
  }

  useItem(slotIndex: number): boolean {
    const item = this.getItem(slotIndex);
    if (!item) return false;
    if (item.type === "Leaf") {
      this.player.health = Math.min(
        this.player.maxHealth,
        this.player.health + 5,
      );
      this.consumeItem(slotIndex);
      return true;
    }
    if (item.type === "Mimic") return this._useMimic(slotIndex);
    if (item.type === "Golden Leaf") {
      this.player?.inventory?.craftingSystem?.showMessage(
        "🍃 Golden Leaf: 减少所有花瓣重载时间",
      );
      return true;
    }
    return false;
  }

  _useMimic(mimicSlotIndex: number): boolean {
    const targetSlotIndex = mimicSlotIndex + 1;
    if (targetSlotIndex >= this.slots.length) {
      this.player?.inventory?.craftingSystem?.showError(
        "No slot to the right",
      );
      return false;
    }
    const targetItem = this.slots[targetSlotIndex];
    if (!targetItem) {
      this.player?.inventory?.craftingSystem?.showError("No item to copy");
      return false;
    }
    const mimicItem = this.slots[mimicSlotIndex];
    // The game's actual copy logic depends on the Item constructor
    const gi = (window as any).gameInstance;
    const ItemCtor = gi?.Item;
    if (!ItemCtor) return false;
    const newItem = new ItemCtor(
      targetItem.type,
      targetItem.level,
      mimicItem.rarity,
    );
    newItem.count = 1;
    newItem.durability = targetItem.durability;
    newItem.maxDurability = targetItem.maxDurability;
    newItem.reloadTime = targetItem.reloadTime;
    newItem.baseReloadTime = targetItem.baseReloadTime;
    newItem.armor = targetItem.armor;
    this.player.inventory.addItem(newItem);
    this.player.inventory.craftingSystem?.showMessage(
      `✨ Created ${mimicItem.rarity} ${targetItem.type}`,
    );
    return true;
  }

  // -----------------------------------------------------------------------
  // Petal sync
  //
  // IMPORTANT: Petals **ignore** mimic state.  The mimic tracker is only
  // used for display / tooltips within the quick-slot bars.  Petals always
  // render as their native type from the slot item.
  // -----------------------------------------------------------------------

  updatePetalFromSlot(slotIndex: number) {
    if (
      !this.player?.petals ||
      slotIndex < 0 ||
      slotIndex >= this.player.petals.length
    )
      return;
    const petal = this.player.petals[slotIndex];
    const item = this.slots[slotIndex];
    if (!petal) return;

    if (item) {
      const stats = item.getStats?.() || {};
      petal.attackPower = stats.attack_power;
      petal.attackCooldownMax = stats.attack_cooldown;
      petal.color = stats.rarity_color;
      petal.itemType = item.type;
      petal.rarity = item.rarity;
      petal.level = item.level;
      petal.size =
        RARITY_ORDER?.length > item.rarity
          ? 20 + item.rarity * 1.2
          : 8;
      petal.armor = stats.armor ?? 0.0;

      if (item.type === "Magnet") {
        petal.magnetRange = stats.magnetRange || 100;
        petal.magnetStrength = stats.magnetStrength || 0.5;
        petal.magnetActive = true;
      } else {
        petal.magnetActive = false;
      }
      petal.hasAntennae = item.type === "Antenna";

      // ★ Petals ignore mimic — always reset mimic-related state on the petal
      petal._isTransformedMimic = false;
      petal._originalMimicData = null;
      petal._mimicDisplayType = null;

      petal.updateFromQuickSlot?.(slotIndex);
    } else {
      petal.resetToDefault?.();
      petal.updateFromQuickSlot?.(slotIndex);
    }
  }

  resetPetalFromSlot(slotIndex: number) {
    if (
      !this.player?.petals ||
      slotIndex < 0 ||
      slotIndex >= this.player.petals.length
    )
      return;
    const petal = this.player.petals[slotIndex];
    if (!petal) return;
    petal._isTransformedMimic = false;
    petal._originalMimicData = null;
    petal._mimicDisplayType = null;
    petal.resetToDefault?.();
  }

  updateAllPetals() {
    if (!this.player) return;
    const newPetals: any[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i] !== null) {
        const existing = this.player.petals?.find(
          (p: any) => p._petalIndex === i,
        );
        if (existing) {
          existing.updateFromQuickSlot?.(i);
          newPetals.push(existing);
        } else {
          const PetalCtor = (window as any).gameInstance?.Petal;
          if (PetalCtor) {
            const petal = new PetalCtor(
              this.player,
              i,
              this.player.petalCount,
            );
            petal.updateFromQuickSlot?.(i);
            newPetals.push(petal);
          }
        }
      } else {
        const existing = this.player.petals?.find(
          (p: any) => p._petalIndex === i,
        );
        if (existing) existing._clearAllSummons?.();
      }
    }
    this.player.petals = newPetals;
    this.player.recalculatePetalAngles?.();
    this._requestRedraw();
  }

  // -----------------------------------------------------------------------
  // Drawing
  // -----------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D) {
    this.updateSlotCount();
    const { n, startX, startY, secStartX, secStartY, secSize, secSpacing } =
      this._layout();
    const slotSize = this.SLOT_SIZE;
    const slotMargin = this.SLOT_SPACING;

    // ── Secondary (upper / smaller) row ──
    for (let i = 0; i < n; i++) {
      const sx = secStartX + i * (secSize + secSpacing);
      const sy = secStartY;

      // Background
      ctx.fillStyle = "rgb(244,244,244)";
      ctx.fillRect(sx, sy, secSize, secSize);
      ctx.strokeStyle = "rgb(203,203,203)";
      ctx.lineWidth = 3;
      ctx.strokeRect(sx, sy, secSize, secSize);

      const item = this.secondarySlots[i];
      if (item?.draw) {
        this._drawItemWithRefresh(ctx, item, sx, sy, secSize);
      }
    }

    // ── Primary (lower / larger) row ──
    for (let i = 0; i < n; i++) {
      const sx = startX + i * (slotSize + slotMargin);
      const sy = startY;

      ctx.fillStyle = "rgb(244,244,244)";
      ctx.fillRect(sx, sy, slotSize, slotSize);
      ctx.strokeStyle = "rgb(203,203,203)";
      ctx.lineWidth = 4;
      ctx.strokeRect(sx, sy, slotSize, slotSize);

      const item = this.slots[i];
      if (item?.draw) {
        this._drawItemWithRefresh(ctx, item, sx, sy, slotSize);
      }

      // Petal overlays — petal ignores mimic, so it reads from the real item
      const petal = this.player?.petals?.[i];
      if (petal) {
        if (petal.isReloading) {
          this._drawReloadOverlay(ctx, sx, sy, slotSize, petal);
        } else {
          const dmg = petal.getDamageOverlayRatio?.() ?? 0;
          if (dmg > 0) this._drawDamageOverlay(ctx, sx, sy, slotSize, dmg);
        }
      }
    }

    // ── Tooltips: primary row ──
    for (let i = 0; i < n; i++) {
      const sx = startX + i * (slotSize + slotMargin);
      const sy = startY;
      const item = this.slots[i];
      if (
        item &&
        this.mouseX >= sx &&
        this.mouseX <= sx + slotSize &&
        this.mouseY >= sy &&
        this.mouseY <= sy + slotSize
      ) {
        // Use TooltipSystem if available
        const ts = (window as any).gameInstance?.TooltipSystem;
        if (ts?.drawItemTooltip) {
          ts.drawItemTooltip(
            ctx,
            item,
            sx,
            sy,
            this.mouseX,
            this.mouseY,
            slotSize,
          );
        }
        break;
      }
    }

    // ── Tooltips: secondary row ──
    for (let i = 0; i < n; i++) {
      const sx = secStartX + i * (secSize + secSpacing);
      const sy = secStartY;
      const item = this.secondarySlots[i];
      if (
        item &&
        this.mouseX >= sx &&
        this.mouseX <= sx + secSize &&
        this.mouseY >= sy &&
        this.mouseY <= sy + secSize
      ) {
        const ts = (window as any).gameInstance?.TooltipSystem;
        if (ts?.drawItemTooltip) {
          ts.drawItemTooltip(
            ctx,
            item,
            sx,
            sy,
            this.mouseX,
            this.mouseY,
            secSize,
          );
        }
        break;
      }
    }
  }

  _drawItemWithRefresh(
    ctx: CanvasRenderingContext2D,
    item: any,
    x: number,
    y: number,
    size: number,
  ) {
    const imgLoader = (window as any).imageLoader;
    const img = imgLoader?.getImage(item.type, item.rarity);
    const isImageLoaded = img && img.width > 0 && img.height > 0;
    if (!isImageLoaded && imgLoader) {
      const cacheKey = `${item.type}${item.rarity}`;
      if (imgLoader.scaledCache) {
        for (const key of Object.keys(imgLoader.scaledCache)) {
          if (key.startsWith(cacheKey)) {
            delete imgLoader.scaledCache[key];
          }
        }
      }
      imgLoader.getImage(item.type, item.rarity);
      this._requestRedraw();
    }
    item.draw(ctx, x, y, size, -1000, -1000);
  }

  _drawDamageOverlay(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    damageRatio: number,
  ) {
    const overlay = document.createElement("canvas");
    overlay.width = size;
    overlay.height = size;
    const overlayCtx = overlay.getContext("2d")!;
    const coverHeight = Math.floor(size * damageRatio);
    if (coverHeight > 0) {
      overlayCtx.fillStyle = "rgba(100, 100, 100, 0.5)";
      overlayCtx.fillRect(0, size - coverHeight, size, coverHeight);
      for (let i = 0; i < coverHeight; i++) {
        const alpha = 0.6 - (i * 0.4) / coverHeight;
        overlayCtx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
        overlayCtx.lineWidth = 1;
        overlayCtx.beginPath();
        overlayCtx.moveTo(0, size - i);
        overlayCtx.lineTo(size, size - i);
        overlayCtx.stroke();
      }
    }
    ctx.drawImage(overlay, x, y);
  }

  _drawReloadOverlay(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    petal: any,
  ) {
    const overlay = document.createElement("canvas");
    overlay.width = size;
    overlay.height = size;
    const overlayCtx = overlay.getContext("2d")!;
    const progress = petal.getReloadProgress();
    const totalReloadTime = petal.reloadTime / 1000;
    if (progress < 1.0) {
      const centerX = size / 2;
      const centerY = size / 2;
      const radius = size;
      const currentTime = petal.reloadCooldown / 1000;
      const elapsedTime = totalReloadTime - currentTime;
      if (elapsedTime < 0.5) {
        const firstPhaseProgress = elapsedTime / 0.5;
        overlayCtx.save();
        overlayCtx.beginPath();
        overlayCtx.moveTo(centerX, centerY);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + firstPhaseProgress * Math.PI * 2;
        overlayCtx.arc(centerX, centerY, radius, startAngle, endAngle);
        overlayCtx.closePath();
        overlayCtx.clip();
        overlayCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
        overlayCtx.fillRect(0, 0, size, size);
        overlayCtx.restore();
        overlayCtx.save();
        overlayCtx.translate(centerX, centerY);
        const rotateAngle = firstPhaseProgress * Math.PI * 2;
        overlayCtx.rotate(rotateAngle);
        overlayCtx.beginPath();
        overlayCtx.arc(radius - 15, 0, 5, 0, Math.PI * 2);
        overlayCtx.fillStyle = "white";
        overlayCtx.fill();
        overlayCtx.restore();
      } else {
        const secondPhaseProgress = Math.min(
          1,
          (elapsedTime - 0.5) / (totalReloadTime - 0.5),
        );
        overlayCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
        overlayCtx.fillRect(0, 0, size, size);
        overlayCtx.save();
        overlayCtx.beginPath();
        overlayCtx.moveTo(centerX, centerY);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + secondPhaseProgress * Math.PI * 2;
        overlayCtx.arc(centerX, centerY, radius, startAngle, endAngle);
        overlayCtx.closePath();
        overlayCtx.globalCompositeOperation = "destination-out";
        overlayCtx.fill();
        overlayCtx.restore();
      }
    }
    ctx.drawImage(overlay, x, y);
  }

  // -----------------------------------------------------------------------
  // Mouse
  // -----------------------------------------------------------------------

  handleMouseMove(x: number, y: number) {
    this.mouseX = x;
    this.mouseY = y;
  }

  // -----------------------------------------------------------------------
  // Click handling — supports secondary slot pickup + drag
  // -----------------------------------------------------------------------

  handleClick(pos: [number, number]): boolean {
    const [clickX, clickY] = pos;
    const { n, startX, startY, secStartX, secStartY, secSize, secSpacing } =
      this._layout();

    // ── Secondary row clicks ──
    if (clickY >= secStartY && clickY <= secStartY + secSize) {
      for (let i = 0; i < n; i++) {
        const sx = secStartX + i * (secSize + secSpacing);
        if (clickX < sx || clickX > sx + secSize) continue;
        const item = this.secondarySlots[i];
        if (item) {
          // Create a copy to return to inventory
          const gi = (window as any).gameInstance;
          const ItemCtor = gi?.Item;
          const ni = ItemCtor
            ? new ItemCtor(item.type, item.level, item.rarity)
            : { ...item };
          ni.count = item.count;
          ni.durability = item.durability;
          ni.maxDurability = item.maxDurability;
          ni.isBroken = item.isBroken;
          ni.reloadTime = item.reloadTime;
          ni.baseReloadTime = item.baseReloadTime;
          ni.armor = item.armor;
          this.player?.inventory?.addItem(ni);
          this.secondarySlots[i] = null;
          this._saveSlots();
          this._requestRedraw();
        }
        return true;
      }
    }

    // ── Primary row clicks ──
    if (clickY >= startY && clickY <= startY + this.SLOT_SIZE) {
      for (let i = 0; i < n; i++) {
        const sx = startX + i * (this.SLOT_SIZE + this.SLOT_SPACING);
        if (clickX < sx || clickX > sx + this.SLOT_SIZE) continue;

        const item = this.slots[i];
        const petal = this.player?.petals?.[i];

        if (item) {
          // Clear summons
          if (petal?._clearAllSummons) {
            petal._clearAllSummons();
            petal.eggSpawned = false;
          }

          // Petal ignores mimic — but item may have stored mimic data;
          // restore it when returning to inventory.
          if (
            item.type !== "Mimic" &&
            item._originalMimicData
          ) {
            const od = item._originalMimicData;
            item.type = od.type;
            item.rarity = od.rarity;
            item.level = od.level;
            item.durability = od.durability;
            item.maxDurability = od.maxDurability;
            item.reloadTime = od.reloadTime;
            item.baseReloadTime = od.baseReloadTime;
            item.armor = od.armor;
          }

          const gi = (window as any).gameInstance;
          const ItemCtor = gi?.Item;
          const ni = ItemCtor
            ? new ItemCtor(item.type, item.level, item.rarity)
            : { ...item };
          ni.count = item.count;
          ni.durability = item.durability;
          ni.maxDurability = item.maxDurability;
          ni.isBroken = item.isBroken;
          ni.reloadTime = item.reloadTime;
          ni.baseReloadTime = item.baseReloadTime;
          ni.armor = item.armor;

          this.player?.inventory?.addItem(ni);

          // Reset petal (ignores mimic)
          if (petal) {
            petal._isTransformedMimic = false;
            petal._originalMimicData = null;
            petal._mimicDisplayType = null;
          }
          if (item) {
            item._isTransformedMimic = false;
            item._originalMimicData = null;
            item._mimicDisplayType = null;
          }

          this.slots[i] = null;
          this.resetPetalFromSlot(i);
          this._saveSlots();
          this._requestRedraw();
        }
        return true;
      }
    }
    return false;
  }

  isPointInRect(x: number, y: number, rect: [number, number, number, number]): boolean {
    const [rx, ry, rw, rh] = rect;
    return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  }
}
