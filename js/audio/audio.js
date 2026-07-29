/**
 * Audio engine — all sounds are synthesized with the Web Audio API
 * (filtered noise bursts + oscillators), so the game ships zero audio
 * assets. Sound families match block materials (grass, stone, sand, wood,
 * snow, water).
 */

import { blockDef } from '../core/blocks.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.5;
    this._noiseBuffer = null;
    // AudioContext must be created after a user gesture — init lazily.
    const init = () => { this._init(); document.removeEventListener('click', init); };
    document.addEventListener('click', init);
  }

  _init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // 1s of white noise reused by every noise-based sound
    const len = this.ctx.sampleRate;
    this._noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._startAmbient();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Short filtered-noise burst. The workhorse for steps/digs/breaks. */
  _noise({ freq = 800, q = 1, dur = 0.1, gain = 0.3, type = 'bandpass', drop = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (drop) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq - drop), t + dur);
    filter.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Simple oscillator blip. */
  _tone({ freq = 440, dur = 0.08, gain = 0.15, type = 'square', slide = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Sound profile per block material family. */
  _profile(id) {
    switch (blockDef(id).sound) {
      case 'grass': return { freq: 900, dur: 0.09, gain: 0.22 };
      case 'sand':  return { freq: 1400, dur: 0.1, gain: 0.18, q: 0.6 };
      case 'snow':  return { freq: 2200, dur: 0.08, gain: 0.15, q: 0.5 };
      case 'wood':  return { freq: 350, dur: 0.1, gain: 0.3, q: 2 };
      case 'water': return { freq: 600, dur: 0.25, gain: 0.2, q: 3, drop: 400 };
      case 'stone':
      default:      return { freq: 500, dur: 0.08, gain: 0.28, q: 1.5 };
    }
  }

  step(blockId) { const p = this._profile(blockId); this._noise({ ...p, gain: p.gain * 0.55 }); }
  dig(blockId)  { const p = this._profile(blockId); this._noise({ ...p, dur: p.dur * 1.4 }); }

  breakBlock(blockId) {
    const p = this._profile(blockId);
    this._noise({ ...p, freq: p.freq * 0.7, dur: 0.22, gain: 0.4, drop: p.freq * 0.4 });
  }

  place(blockId) {
    const p = this._profile(blockId);
    this._noise({ ...p, freq: p.freq * 1.2, dur: 0.1, gain: 0.32 });
    this._tone({ freq: 180, dur: 0.06, gain: 0.08, type: 'triangle' });
  }

  play(name) {
    switch (name) {
      case 'jump':   this._noise({ freq: 700, dur: 0.07, gain: 0.12 }); break;
      case 'land':   this._noise({ freq: 400, dur: 0.1, gain: 0.2, drop: 200 }); break;
      case 'hurt':   this._tone({ freq: 220, dur: 0.18, gain: 0.2, type: 'sawtooth', slide: -120 }); break;
      case 'click':  this._tone({ freq: 800, dur: 0.03, gain: 0.08 }); break;
      case 'splash': this._noise({ freq: 900, dur: 0.35, gain: 0.3, q: 2, drop: 600 }); break;
      case 'pop':    this._tone({ freq: 500, dur: 0.07, gain: 0.15, type: 'sine', slide: 400 }); break;
      case 'eat':
        this._noise({ freq: 600, dur: 0.09, gain: 0.25, q: 2 });
        setTimeout(() => this._noise({ freq: 500, dur: 0.09, gain: 0.22, q: 2 }), 130);
        setTimeout(() => this._noise({ freq: 550, dur: 0.09, gain: 0.2, q: 2 }), 260);
        break;
    }
  }

  /** Gentle looping wind/ambience bed. */
  _startAmbient() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    const g = this.ctx.createGain();
    g.gain.value = 0.015;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    // slow amplitude wander for a breathing wind feel
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
  }
}
