/**
 * Sky & lighting: day/night cycle, orbiting sun with cascaded-ish shadow
 * coverage around the player, ambient + hemisphere light, time-of-day sky
 * and fog colors, moving clouds, and stars at night.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { mulberry32 } from '../core/noise.js';

// Sky gradient keyframes over the day (t: 0 = 6:00 sunrise, 0.25 = noon,
// 0.5 = 18:00 sunset, 0.75 = midnight)
const SKY_KEYS = [
  { t: 0.00, sky: 0xffb36b, fog: 0xffc891 },   // sunrise
  { t: 0.08, sky: 0x87ceeb, fog: 0xc9e6f2 },   // morning
  { t: 0.25, sky: 0x6db3f2, fog: 0xbfe0f5 },   // noon
  { t: 0.42, sky: 0x87ceeb, fog: 0xc9e6f2 },   // afternoon
  { t: 0.50, sky: 0xff8c47, fog: 0xffab73 },   // sunset
  { t: 0.58, sky: 0x0c1445, fog: 0x101830 },   // dusk
  { t: 0.75, sky: 0x050a20, fog: 0x080d1e },   // midnight
  { t: 0.92, sky: 0x0c1445, fog: 0x101830 },   // pre-dawn
  { t: 1.00, sky: 0xffb36b, fog: 0xffc891 },   // sunrise again
];

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    /** timeOfDay in [0,1). 0 = sunrise. */
    this.time = 0.05;
    this.paused = false;

    scene.fog = new THREE.Fog(0xc9e6f2, 60, 300);

    // ---- Lights ----
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 400;
    const s = 90;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0004;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x66542e, 0.5);
    scene.add(this.hemi);

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // ---- Sun / moon sprites ----
    this.sunMesh = this._makeDisc(0xfff4b0, 14);
    this.moonMesh = this._makeDisc(0xdfe8ff, 9);
    scene.add(this.sunMesh, this.moonMesh);

    // ---- Stars ----
    this.stars = this._makeStars();
    scene.add(this.stars);

    // ---- Clouds ----
    this.clouds = this._makeClouds();
    scene.add(this.clouds);

    this._skyColor = new THREE.Color();
    this._fogColor = new THREE.Color();
  }

  _makeDisc(color, size) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide })
    );
    mesh.frustumCulled = false;
    return mesh;
  }

  _makeStars() {
    const rand = mulberry32(99);
    const positions = [];
    for (let i = 0; i < 500; i++) {
      // random directions on the upper hemisphere, far away
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(rand());
      const r = 450;
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, fog: false,
    });
    const stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    return stars;
  }

  _makeClouds() {
    // Flat white boxes drifting at cloud height, instanced for performance.
    const rand = mulberry32(7);
    const COUNT = 90;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity: 0.75, fog: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) {
      const w = 14 + rand() * 30, d = 10 + rand() * 24;
      m.makeScale(w, 3, d);
      m.setPosition((rand() - 0.5) * 900, 150 + rand() * 12, (rand() - 0.5) * 900);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Sample the sky color keyframes at time t. */
  _sample(t) {
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / (b.t - a.t || 1);
        this._skyColor.setHex(a.sky).lerp(new THREE.Color(b.sky), f);
        this._fogColor.setHex(a.fog).lerp(new THREE.Color(b.fog), f);
        return;
      }
    }
    this._skyColor.setHex(SKY_KEYS[0].sky);
    this._fogColor.setHex(SKY_KEYS[0].fog);
  }

  /** Daylight factor 0 (midnight) .. 1 (noon). */
  get daylight() {
    const angle = this.time * Math.PI * 2;    // 0 = sunrise
    return Math.max(0, Math.sin(angle));
  }

  update(dt, playerPos, renderDistance) {
    if (!this.paused) this.time = (this.time + dt / CONFIG.DAY_LENGTH) % 1;

    const angle = this.time * Math.PI * 2;
    const day = this.daylight;

    // ---- Sun orbit (east→west over the player) ----
    const r = 300;
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.25).normalize();
    this.sun.position.copy(playerPos).addScaledVector(sunDir, r);
    this.sun.target.position.copy(playerPos);
    this.sun.intensity = 1.35 * Math.pow(day, 0.7);
    // warm tint at low sun
    const warmth = Math.max(0, 1 - day * 2.2);
    this.sun.color.setRGB(1, 1 - warmth * 0.35, 1 - warmth * 0.6);

    this.sunMesh.position.copy(playerPos).addScaledVector(sunDir, 420);
    this.sunMesh.lookAt(playerPos);
    this.moonMesh.position.copy(playerPos).addScaledVector(sunDir, -420);
    this.moonMesh.lookAt(playerPos);

    // ---- Ambient scales with daylight (moonlight floor at night) ----
    this.ambient.intensity = 0.12 + day * 0.4;
    this.hemi.intensity = 0.15 + day * 0.4;

    // ---- Sky, fog, stars ----
    this._sample(this.time);
    this.scene.background = this._skyColor;
    this.scene.fog.color.copy(this._fogColor);
    const far = renderDistance * CONFIG.CHUNK_SIZE;
    this.scene.fog.near = far * 0.55;
    this.scene.fog.far = far * 0.98;

    this.stars.material.opacity = Math.max(0, 0.9 - day * 3);
    this.stars.position.copy(playerPos);

    // ---- Clouds drift ----
    this.clouds.position.x += dt * 1.5;
    if (this.clouds.position.x > 450) this.clouds.position.x = -450;
    this.clouds.position.z = playerPos.z * 0.0; // world-anchored
  }
}
