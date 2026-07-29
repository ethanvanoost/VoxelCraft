/**
 * Chat command console (press T). Supports:
 *   /tp <x> <y> <z>       teleport
 *   /time set <day|night|noon|midnight|0..1>
 *   /give <blockName> [count]
 *   /gamemode <creative|survival>   (creative = fly + no fall damage)
 *   /seed                 show world seed
 *   /clear                clear inventory
 */

import { BLOCK, ITEM, blockDef, itemDef } from '../core/blocks.js';

export class Commands {
  constructor(player, world, inventory, sky) {
    this.player = player;
    this.world = world;
    this.inventory = inventory;
    this.sky = sky;
    this.open = false;
    this.creative = false;

    this.input = document.getElementById('chat-input');
    this.chat = document.getElementById('chat');
    this.log = document.getElementById('chat-log');

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') { this.run(this.input.value.trim()); this.close(); }
      if (e.code === 'Escape') this.close();
    });
  }

  openChat() {
    this.open = true;
    this.chat.classList.remove('hidden');
    this.input.value = '';
    setTimeout(() => this.input.focus(), 0);
  }

  close() {
    this.open = false;
    this.chat.classList.add('hidden');
    this.input.blur();
  }

  print(text) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.textContent = text;
    this.log.appendChild(div);
    while (this.log.children.length > 6) this.log.removeChild(this.log.firstChild);
    setTimeout(() => div.remove(), 8000);
  }

  run(text) {
    if (!text) return;
    if (!text.startsWith('/')) { this.print(`<you> ${text}`); return; }
    const [cmd, ...args] = text.slice(1).split(/\s+/);

    switch (cmd.toLowerCase()) {
      case 'tp': {
        const [x, y, z] = args.map(Number);
        if ([x, y, z].some(Number.isNaN)) return this.print('Usage: /tp <x> <y> <z>');
        this.player.position.set(x, y, z);
        this.player.velocity.set(0, 0, 0);
        this.print(`Teleported to ${x} ${y} ${z}`);
        break;
      }
      case 'time': {
        if (args[0] !== 'set') return this.print('Usage: /time set <day|night|value>');
        const presets = { day: 0.05, noon: 0.25, sunset: 0.5, night: 0.6, midnight: 0.75 };
        const v = presets[args[1]] ?? parseFloat(args[1]);
        if (Number.isNaN(v)) return this.print('Unknown time: ' + args[1]);
        this.sky.time = ((v % 1) + 1) % 1;
        this.print('Time set.');
        break;
      }
      case 'give': {
        const name = (args[0] || '').toLowerCase().replace(/_/g, ' ');
        const count = parseInt(args[1], 10) || 64;
        const entry = [...Object.entries(BLOCK), ...Object.entries(ITEM)].find(([key, id]) =>
          key.toLowerCase().replace(/_/g, ' ') === name ||
          itemDef(id).name.toLowerCase() === name);
        if (!entry) return this.print('Unknown block/item: ' + args[0]);
        this.inventory.add(entry[1], count);
        this.print(`Gave ${count} × ${itemDef(entry[1]).name}`);
        break;
      }
      case 'gamemode': {
        this.creative = args[0] === 'creative' || args[0] === '1';
        if (this.creative) this.player.flying = true;
        this.print(`Game mode: ${this.creative ? 'Creative' : 'Survival'}`);
        break;
      }
      case 'seed':
        this.print('Seed: ' + this.world.seed);
        break;
      case 'clear':
        this.inventory.slots.fill(null);
        this.inventory.renderAll();
        this.print('Inventory cleared.');
        break;
      default:
        this.print('Unknown command: /' + cmd);
    }
  }
}
