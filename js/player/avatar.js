/**
 * Player avatar: a simple Minecraft-style box model (head, body, arms, legs)
 * colored by the player's skin, with a floating name tag sprite. Used for
 * the local player in 2nd/3rd person and for remote players in multiplayer.
 */

import * as THREE from 'three';

export const DEFAULT_SKIN = {
  head: '#c8945f', body: '#00a8a8', arms: '#c8945f', legs: '#3f3f8f', eyes: '#3f3fff',
};

/** Head texture with a simple pixel face on the front. */
function makeHeadTexture(skin) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const ctx = c.getContext('2d');
  ctx.fillStyle = skin.head;
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1, 3, 2, 1); ctx.fillRect(5, 3, 2, 1);   // eye whites
  ctx.fillStyle = skin.eyes;
  ctx.fillRect(2, 3, 1, 1); ctx.fillRect(5, 3, 1, 1);   // pupils
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(3, 5, 2, 1);                             // mouth
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

function makeNameSprite(name) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = 'bold 28px monospace';
  const w = Math.max(64, ctx.measureText(name).width + 20);
  c.width = w; c.height = 40;
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = 'rgba(0,0,0,0.45)';
  ctx2.fillRect(0, 0, w, 40);
  ctx2.font = 'bold 28px monospace';
  ctx2.fillStyle = '#fff';
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.fillText(name, w / 2, 21);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(w / 80, 0.5, 1);
  return sprite;
}

export class Avatar {
  /**
   * @param name player name shown above the head
   * @param skin {head, body, arms, legs, eyes} hex colors
   */
  constructor(name, skin = DEFAULT_SKIN) {
    this.group = new THREE.Group();
    skin = { ...DEFAULT_SKIN, ...skin };

    const mat = (color) => new THREE.MeshLambertMaterial({ color });
    const headMat = mat(skin.head);
    const faceMat = new THREE.MeshLambertMaterial({ map: makeHeadTexture(skin) });

    // Proportions (world units, player is ~1.8 tall)
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
      [headMat, headMat, headMat, headMat, faceMat, headMat]); // +z is the face
    this.head.position.y = 1.55;

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), mat(skin.body));
    body.position.y = 0.95;

    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), mat(skin.arms));
    this.armL.position.set(-0.38, 0.95, 0);
    this.armR = this.armL.clone();
    this.armR.material = mat(skin.arms);
    this.armR.position.x = 0.38;

    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.75, 0.23), mat(skin.legs));
    this.legL.position.set(-0.13, 0.375, 0);
    this.legR = this.legL.clone();
    this.legR.material = mat(skin.legs);
    this.legR.position.x = 0.13;

    this.nameTag = makeNameSprite(name || 'Player');
    this.nameTag.position.y = 2.15;

    this.group.add(this.head, body, this.armL, this.armR, this.legL, this.legR, this.nameTag);
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

    this._walkPhase = 0;
    this._lastPos = new THREE.Vector3();
  }

  /** Update pose. yaw = body facing, pitch tilts the head. */
  update(pos, yaw, pitch, dt = 0.016) {
    // Walk-cycle from horizontal movement
    const speed = this._lastPos.distanceTo(pos) / Math.max(dt, 0.001);
    this._lastPos.copy(pos);
    this._walkPhase += dt * Math.min(speed, 8) * 3;
    const swing = Math.sin(this._walkPhase) * Math.min(speed / 4, 1) * 0.7;

    this.group.position.copy(pos);
    this.group.rotation.y = yaw + Math.PI;   // model faces +z; yaw 0 looks -z
    this.head.rotation.x = -pitch * 0.8;
    this.armL.rotation.x = swing;
    this.armR.rotation.x = -swing;
    this.legL.rotation.x = -swing;
    this.legR.rotation.x = swing;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m) => { m.map?.dispose?.(); m.dispose(); });
      else { o.material?.map?.dispose?.(); o.material?.dispose?.(); }
    });
  }
}

/** Draws the skin editor preview (front view) onto a 2D canvas. */
export function drawSkinPreview(canvas, skin) {
  skin = { ...DEFAULT_SKIN, ...skin };
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const u = canvas.width / 8;   // 8 units wide
  // head
  ctx.fillStyle = skin.head; ctx.fillRect(2 * u, 0, 4 * u, 4 * u);
  ctx.fillStyle = '#fff';
  ctx.fillRect(2.7 * u, 1.8 * u, u, 0.6 * u); ctx.fillRect(4.3 * u, 1.8 * u, u, 0.6 * u);
  ctx.fillStyle = skin.eyes;
  ctx.fillRect(3.1 * u, 1.8 * u, 0.6 * u, 0.6 * u); ctx.fillRect(4.3 * u, 1.8 * u, 0.6 * u, 0.6 * u);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(3.5 * u, 3 * u, u, 0.5 * u);
  // body
  ctx.fillStyle = skin.body; ctx.fillRect(2 * u, 4 * u, 4 * u, 4.5 * u);
  // arms
  ctx.fillStyle = skin.arms;
  ctx.fillRect(0.7 * u, 4 * u, 1.3 * u, 4.5 * u); ctx.fillRect(6 * u, 4 * u, 1.3 * u, 4.5 * u);
  // legs
  ctx.fillStyle = skin.legs;
  ctx.fillRect(2 * u, 8.5 * u, 1.9 * u, 3.5 * u); ctx.fillRect(4.1 * u, 8.5 * u, 1.9 * u, 3.5 * u);
}
