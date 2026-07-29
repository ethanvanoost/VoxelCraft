/**
 * Settings panel: render distance, FOV, mouse sensitivity, volume,
 * fullscreen. Values persist to localStorage.
 */

import { CONFIG } from '../core/config.js';

const DEFAULTS = { renderDistance: 6, fov: 75, sensitivity: 1, volume: 50 };

export class Settings {
  /**
   * @param apply object of callbacks: { renderDistance, fov, sensitivity, volume }
   */
  constructor(apply) {
    this.apply = apply;
    this.values = { ...DEFAULTS, ...this._loadStored() };

    this.els = {
      render: document.getElementById('set-render'),
      fov: document.getElementById('set-fov'),
      sens: document.getElementById('set-sens'),
      volume: document.getElementById('set-volume'),
      valRender: document.getElementById('val-render'),
      valFov: document.getElementById('val-fov'),
      valSens: document.getElementById('val-sens'),
      valVolume: document.getElementById('val-volume'),
    };

    this._bind('render', 'renderDistance', 'valRender', v => v);
    this._bind('fov', 'fov', 'valFov', v => v);
    this._bind('sens', 'sensitivity', 'valSens', v => v.toFixed(1));
    this._bind('volume', 'volume', 'valVolume', v => v);

    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    });

    this.applyAll();
  }

  _loadStored() {
    try { return JSON.parse(localStorage.getItem(CONFIG.SETTINGS_KEY)) || {}; }
    catch { return {}; }
  }

  _store() {
    localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(this.values));
  }

  _bind(elKey, valueKey, labelKey, format) {
    const el = this.els[elKey];
    el.value = this.values[valueKey];
    this.els[labelKey].textContent = format(this.values[valueKey]);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      this.values[valueKey] = v;
      this.els[labelKey].textContent = format(v);
      this.apply[valueKey]?.(v);
      this._store();
    });
  }

  applyAll() {
    for (const [key, value] of Object.entries(this.values)) {
      this.apply[key]?.(value);
    }
  }
}
