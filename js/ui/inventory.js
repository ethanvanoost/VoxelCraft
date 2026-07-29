/**
 * Inventory: 27-slot main grid + 9-slot hotbar, 64-stack items,
 * scroll-wheel / number-key hotbar selection, drag & drop, and a crafting
 * area (2×2 in the inventory, 3×3 when opened from a crafting table).
 *
 * The player starts with nothing — punch trees for logs, craft planks,
 * then a crafting table (see core/recipes.js).
 */

import { BLOCK, ITEM, BLOCK_DEFS, faceTile, itemDef, maxStack } from '../core/blocks.js';
import { matchRecipe } from '../core/recipes.js';

const HOTBAR_SIZE = 9;
const MAIN_SIZE = 27;

// Slot index namespaces for click routing
const CRAFT_BASE = 100;   // craft grid cells are CRAFT_BASE + i (i in 0..8)
const RESULT_INDEX = 200; // crafting result slot
const CHEST_BASE = 400;   // open-chest slots are CHEST_BASE + i (i in 0..26)
const CREATIVE_BASE = 600;// creative palette entries
const FURNACE_BASE = 700; // furnace slots: 700 input, 701 fuel, 702 output

export class Inventory {
  constructor(atlas, audio) {
    this.atlas = atlas;
    this.audio = audio;
    /** slots[0..8] = hotbar, slots[9..35] = main grid. null or {id, count}. */
    this.slots = new Array(HOTBAR_SIZE + MAIN_SIZE).fill(null);
    this.selected = 0;
    this.open = false;
    this.dragging = null;   // {id, count} held on the cursor

    /** Crafting state: 3×3 backing array (only top-left 2×2 used in hand mode). */
    this.craft = new Array(9).fill(null);
    this.craftSize = 2;
    this.result = null;     // computed {id, count} preview

    /** Open chest: reference to a 27-slot array (world/chest storage). */
    this.chest = null;
    this.onChestChange = null;   // callback after any chest slot changes
    /** Open furnace: reference to {slots:[in,fuel,out], progress, burn}. */
    this.furnace = null;
    this.creativeMode = false;

    this._iconCache = new Map();
    this._els = {
      hotbar: document.getElementById('hotbar'),
      screen: document.getElementById('inventory-screen'),
      grid: document.getElementById('inventory-grid'),
      invHotbar: document.getElementById('inventory-hotbar'),
      craftGrid: document.getElementById('craft-grid'),
      craftResult: document.getElementById('craft-result'),
      craftBlock: document.getElementById('craft-block'),
      chestArea: document.getElementById('chest-area'),
      chestGrid: document.getElementById('chest-grid'),
      furnaceArea: document.getElementById('furnace-area'),
      furnaceIn: document.getElementById('furnace-in'),
      furnaceFuel: document.getElementById('furnace-fuel'),
      furnaceOut: document.getElementById('furnace-out'),
      furnaceFlame: document.getElementById('furnace-flame'),
      furnaceFill: document.getElementById('furnace-progress-fill'),
      creativeArea: document.getElementById('creative-area'),
      creativeGrid: document.getElementById('creative-grid'),
      drag: document.getElementById('drag-item'),
      name: document.getElementById('selected-block-name'),
    };

    this._buildDOM();
    this._bindInput();
    this.renderAll();
  }

  // ---------------- Model ----------------

  selectedItem() { return this.slots[this.selected]; }

  /** Add items, stacking first then filling empty slots. Returns leftover. */
  add(id, count) {
    if (id === BLOCK.AIR) return 0;
    const cap = maxStack(id);
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < cap) {
        const take = Math.min(cap - s.count, count);
        s.count += take; count -= take;
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(cap, count);
        this.slots[i] = { id, count: take }; count -= take;
      }
    }
    this.renderAll();
    return count;
  }

  consumeSelected() {
    const s = this.slots[this.selected];
    if (!s) return;
    if (--s.count <= 0) this.slots[this.selected] = null;
    this.renderAll();
  }

  select(i) {
    this.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.renderAll();
    this._showName();
  }

  serialize() { return { slots: this.slots, selected: this.selected }; }

  load(data) {
    if (!data) return;
    if (Array.isArray(data.slots) && data.slots.length === this.slots.length) {
      this.slots = data.slots.map(s => (s && s.id ? { id: s.id, count: s.count } : null));
    }
    this.selected = data.selected ?? 0;
    this.renderAll();
  }

  // ---------------- DOM ----------------

  _buildDOM() {
    const { hotbar, grid, invHotbar, craftGrid, craftResult } = this._els;
    for (let i = 0; i < HOTBAR_SIZE; i++) hotbar.appendChild(this._makeSlot(i, false));
    for (let i = HOTBAR_SIZE; i < HOTBAR_SIZE + MAIN_SIZE; i++) grid.appendChild(this._makeSlot(i, true));
    for (let i = 0; i < HOTBAR_SIZE; i++) invHotbar.appendChild(this._makeSlot(i, true));
    for (let i = 0; i < 9; i++) craftGrid.appendChild(this._makeSlot(CRAFT_BASE + i, true));
    craftResult.appendChild(this._makeSlot(RESULT_INDEX, true));
    for (let i = 0; i < 27; i++) this._els.chestGrid.appendChild(this._makeSlot(CHEST_BASE + i, true));
    this._els.furnaceIn.appendChild(this._makeSlot(FURNACE_BASE, true));
    this._els.furnaceFuel.appendChild(this._makeSlot(FURNACE_BASE + 1, true));
    this._els.furnaceOut.appendChild(this._makeSlot(FURNACE_BASE + 2, true));

    // Creative palette: every real block + item, one slot each
    this._creativeIds = [
      ...Object.keys(BLOCK_DEFS).map(Number).filter((id) => id !== BLOCK.AIR),
      ...Object.values(ITEM),
    ];
    this._creativeIds.forEach((id, i) => {
      const el = this._makeSlot(CREATIVE_BASE + i, true);
      this._els.creativeGrid.appendChild(el);
    });
    this._applyCraftSize();
  }

  /** Show a 2×2 or 3×3 crafting grid (cells outside the size are hidden). */
  _applyCraftSize() {
    const size = this.craftSize;
    this._els.craftGrid.style.gridTemplateColumns = `repeat(${size}, var(--slot-size))`;
    [...this._els.craftGrid.children].forEach((el, i) => {
      const r = Math.floor(i / 3), c = i % 3;
      el.classList.toggle('hidden', r >= size || c >= size);
    });
  }

  _makeSlot(index, interactive) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.index = index;
    if (interactive) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._slotClick(index, e.button === 2);
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    return el;
  }

  /** Click while inventory open: pick up / put down / split / merge stacks. */
  _slotClick(index, rightClick) {
    if (!this.open) return;

    if (index === RESULT_INDEX) { this._takeResult(); return; }

    // Creative palette: click grabs a full stack; click while holding = trash
    if (index >= CREATIVE_BASE) {
      if (this.dragging) { this.dragging = null; }
      else {
        const id = this._creativeIds[index - CREATIVE_BASE];
        this.dragging = { id, count: maxStack(id) };
      }
      this.audio?.play('click');
      this.renderAll();
      return;
    }

    // Furnace output: take-only (pick up or merge into held stack)
    if (index === FURNACE_BASE + 2) {
      if (!this.furnace) return;
      const out = this.furnace.slots[2];
      if (!out) return;
      if (!this.dragging) { this.dragging = out; this.furnace.slots[2] = null; }
      else if (this.dragging.id === out.id && this.dragging.count + out.count <= maxStack(out.id)) {
        this.dragging.count += out.count;
        this.furnace.slots[2] = null;
      } else return;
      this.audio?.play('click');
      this.renderAll();
      return;
    }

    // Route to the right backing array (slots / craft grid / chest / furnace)
    const isFurnace = index >= FURNACE_BASE;
    const isChest = !isFurnace && index >= CHEST_BASE && index < CREATIVE_BASE;
    const isCraft = !isFurnace && !isChest && index >= CRAFT_BASE;
    const arr = isFurnace ? this.furnace?.slots
              : isChest ? this.chest
              : isCraft ? this.craft : this.slots;
    const i = isFurnace ? index - FURNACE_BASE
            : isChest ? index - CHEST_BASE
            : isCraft ? index - CRAFT_BASE : index;
    if (!arr) return;
    const slot = arr[i];

    if (!this.dragging) {
      if (!slot) return;
      if (rightClick) {  // pick up half
        const half = Math.ceil(slot.count / 2);
        this.dragging = { id: slot.id, count: half };
        slot.count -= half;
        if (slot.count <= 0) arr[i] = null;
      } else {           // pick up all
        this.dragging = slot;
        arr[i] = null;
      }
    } else {
      if (!slot) {       // place one (right) or all (left)
        if (rightClick) {
          arr[i] = { id: this.dragging.id, count: 1 };
          if (--this.dragging.count <= 0) this.dragging = null;
        } else {
          arr[i] = this.dragging;
          this.dragging = null;
        }
      } else if (slot.id === this.dragging.id) {  // merge
        const amount = rightClick ? 1 : this.dragging.count;
        const take = Math.min(maxStack(slot.id) - slot.count, amount);
        slot.count += take;
        this.dragging.count -= take;
        if (this.dragging.count <= 0) this.dragging = null;
      } else {           // swap
        const tmp = arr[i];
        arr[i] = this.dragging;
        this.dragging = tmp;
      }
    }
    if (isCraft) this._updateResult();
    if (isChest) this.onChestChange?.();
    this.audio?.play('click');
    this.renderAll();
  }

  // ---------------- Crafting ----------------

  /** Flatten the active craftSize×craftSize window of the 3×3 backing grid. */
  _craftCells() {
    const size = this.craftSize;
    const cells = [];
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        cells.push(this.craft[r * 3 + c]?.id || 0);
    return cells;
  }

  _updateResult() {
    this.result = matchRecipe(this._craftCells(), this.craftSize);
  }

  /** Click the result slot: craft once, consuming 1 item per occupied cell. */
  _takeResult() {
    if (!this.result) return;
    // Result goes onto the cursor (merges if same item)
    if (this.dragging) {
      if (this.dragging.id !== this.result.id) return;
      if (this.dragging.count + this.result.count > maxStack(this.result.id)) return;
      this.dragging.count += this.result.count;
    } else {
      this.dragging = { id: this.result.id, count: this.result.count };
    }
    for (let i = 0; i < 9; i++) {
      const s = this.craft[i];
      if (s && --s.count <= 0) this.craft[i] = null;
    }
    this._updateResult();
    this.audio?.play('click');
    this.renderAll();
  }

  /** Return all craft-grid items to the inventory (called on close). */
  _dumpCraftGrid() {
    for (let i = 0; i < 9; i++) {
      if (this.craft[i]) {
        this.add(this.craft[i].id, this.craft[i].count);
        this.craft[i] = null;
      }
    }
    this.result = null;
  }

  _bindInput() {
    // Scroll wheel hotbar selection
    document.addEventListener('wheel', (e) => {
      if (this.open || !document.pointerLockElement) return;
      this.select(this.selected + Math.sign(e.deltaY));
    });
    // Number keys
    document.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) this.select(n - 1);
      }
    });
    // Drag item follows the cursor
    document.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        this._els.drag.style.left = e.clientX - 24 + 'px';
        this._els.drag.style.top = e.clientY - 24 + 'px';
      }
    });
  }

  /**
   * Open/close the inventory screen.
   * @param craftSize 2 = hand crafting, 3 = crafting table
   */
  toggle(forceClose = false, craftSize = 2) {
    this.open = forceClose ? false : !this.open;
    this._els.screen.classList.toggle('hidden', !this.open);
    if (this.open) {
      this.craftSize = craftSize;
      this._applyCraftSize();
      this._updateResult();
      this._els.chestArea.classList.toggle('hidden', !this.chest);
      this._els.furnaceArea.classList.toggle('hidden', !this.furnace);
      this._els.craftBlock.classList.toggle('hidden', !!this.chest || !!this.furnace);
      this._els.creativeArea.classList.toggle('hidden', !this.creativeMode || !!this.chest || !!this.furnace);
    } else {
      this._dumpCraftGrid();             // don't lose items left in the grid
      if (this.dragging) {               // drop held stack back into inventory
        if (!this.creativeMode) this.add(this.dragging.id, this.dragging.count);
        this.dragging = null;
      }
      this.chest = null;
      this.onChestChange = null;
      this.furnace = null;
    }
    this.renderAll();
    return this.open;
  }

  /** Open the inventory with a chest's 27 slots attached. */
  openChest(chestSlots, onChange) {
    this.chest = chestSlots;
    this.onChestChange = onChange || null;
    this.open = false;       // force toggle() into the "opening" branch
    this.toggle();
  }

  /** Open the inventory with a furnace attached. */
  openFurnace(furnaceState) {
    this.furnace = furnaceState;
    this.open = false;
    this.toggle();
  }

  /** Live furnace display (called each frame by main while open). */
  updateFurnaceView() {
    if (!this.open || !this.furnace) return;
    this._els.furnaceFlame.classList.toggle('lit', this.furnace.burn > 0);
    this._els.furnaceFill.style.width = `${Math.min(100, (this.furnace.progress / 5) * 100)}%`;
  }

  /** Wipe everything (death). */
  clearAll() {
    this.slots.fill(null);
    this.renderAll();
  }

  setCreative(on) { this.creativeMode = !!on; }

  // ---------------- Rendering ----------------

  _icon(id) {
    if (this._iconCache.has(id)) return this._iconCache.get(id);
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Items (sticks, ingots, tools...) render as flat sprites
    if (id >= 256) {
      const tile = this.atlas.tileCanvas(itemDef(id).icon || 'stone');
      ctx.drawImage(tile, 0, 0, tile.width, tile.height, 0, 0, 32, 32);
      this._iconCache.set(id, c);
      return c;
    }

    // Blocks render as pseudo-3D cubes: top + two shaded side faces
    const top = this.atlas.tileCanvas(faceTile(id, 'top'));
    const side = this.atlas.tileCanvas(faceTile(id, 'side'));

    // top face
    ctx.save();
    ctx.transform(1, -0.5, 1, 0.5, 0, 8);
    ctx.drawImage(top, 0, 0, 16, 16);
    ctx.restore();
    // left face (darkened)
    ctx.save();
    ctx.transform(1, 0.5, 0, 1, 0, 8);
    ctx.filter = 'brightness(0.72)';
    ctx.drawImage(side, 0, 0, 16, 16);
    ctx.restore();
    // right face (darker)
    ctx.save();
    ctx.transform(1, -0.5, 0, 1, 16, 16);
    ctx.filter = 'brightness(0.55)';
    ctx.drawImage(side, 0, 0, 16, 16);
    ctx.restore();

    this._iconCache.set(id, c);
    return c;
  }

  _renderSlot(el, slot, selected) {
    el.classList.toggle('selected', !!selected);
    el.innerHTML = '';
    if (slot) {
      const icon = this._icon(slot.id).cloneNode();
      icon.getContext('2d').drawImage(this._icon(slot.id), 0, 0);
      el.appendChild(icon);
      if (slot.count > 1) {
        const count = document.createElement('div');
        count.className = 'count';
        count.textContent = slot.count;
        el.appendChild(count);
      }
    }
  }

  renderAll() {
    const { hotbar, grid, invHotbar, craftGrid, craftResult, drag } = this._els;
    [...hotbar.children].forEach((el, i) =>
      this._renderSlot(el, this.slots[i], i === this.selected));
    [...grid.children].forEach((el, i) =>
      this._renderSlot(el, this.slots[HOTBAR_SIZE + i], false));
    [...invHotbar.children].forEach((el, i) =>
      this._renderSlot(el, this.slots[i], i === this.selected));
    [...craftGrid.children].forEach((el, i) =>
      this._renderSlot(el, this.craft[i], false));
    this._renderSlot(craftResult.firstChild, this.result, false);
    if (this.chest) {
      [...this._els.chestGrid.children].forEach((el, i) =>
        this._renderSlot(el, this.chest[i], false));
    }
    if (this.furnace) {
      this._renderSlot(this._els.furnaceIn.firstChild, this.furnace.slots[0], false);
      this._renderSlot(this._els.furnaceFuel.firstChild, this.furnace.slots[1], false);
      this._renderSlot(this._els.furnaceOut.firstChild, this.furnace.slots[2], false);
    }
    if (this.creativeMode && !this._creativeRendered) {
      [...this._els.creativeGrid.children].forEach((el, i) =>
        this._renderSlot(el, { id: this._creativeIds[i], count: 1 }, false));
      this._creativeRendered = true;
    }

    // Cursor-held stack
    drag.classList.toggle('hidden', !this.dragging);
    if (this.dragging) {
      drag.innerHTML = '';
      const icon = document.createElement('canvas');
      icon.width = 32; icon.height = 32;
      icon.getContext('2d').drawImage(this._icon(this.dragging.id), 0, 0);
      drag.appendChild(icon);
      if (this.dragging.count > 1) {
        const count = document.createElement('div');
        count.className = 'count';
        count.textContent = this.dragging.count;
        drag.appendChild(count);
      }
    }
  }

  _showName() {
    const s = this.selectedItem();
    const el = this._els.name;
    el.textContent = s ? itemDef(s.id).name : '';
    el.style.opacity = 1;
    clearTimeout(this._nameTimer);
    this._nameTimer = setTimeout(() => { el.style.opacity = 0; }, 1500);
  }
}
