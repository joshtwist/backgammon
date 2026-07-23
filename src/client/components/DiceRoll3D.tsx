import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Color, DicePair } from "../../shared/types.ts";
import { DieFace } from "./Dice.tsx";

/**
 * WebGL dice-roll theater: two 3D dice tumble in across the board and
 * settle showing the (server-authoritative) rolled values. No physics
 * engine — the motion is scripted and the resting orientation is solved
 * directly, so the dice always land on the correct faces.
 *
 * If a WebGL context can't be created (rare, old devices), we fall back
 * to the flat 2D dice so the reveal still happens.
 */

// BoxGeometry face order is [+X, -X, +Y, -Y, +Z, -Z]. Assign values so
// opposite faces sum to 7, and record each value's local face normal.
const FACE_VALUES = [1, 6, 2, 5, 3, 4] as const;
const FACE_NORMALS: Record<number, [number, number, number]> = {
  1: [1, 0, 0],
  6: [-1, 0, 0],
  2: [0, 1, 0],
  5: [0, -1, 0],
  3: [0, 0, 1],
  4: [0, 0, -1],
};

const PIP_CELLS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Draw one die face (value's pips on an ivory ground) to a texture. */
function faceTexture(value: number): THREE.CanvasTexture {
  const S = 160;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#f4eddc";
  ctx.fillRect(0, 0, S, S);
  // Soft inner border so edges read as a physical die.
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, S - 6, S - 6);

  const pad = S * 0.24;
  const gap = (S - pad * 2) / 2;
  const r = S * 0.088;
  ctx.fillStyle = "#2a2a38";
  for (const cell of PIP_CELLS[value] ?? []) {
    const col = cell % 3;
    const row = Math.floor(cell / 3);
    ctx.beginPath();
    ctx.arc(pad + col * gap, pad + row * gap, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Quaternion that lands `value` face-up, with an added yaw for variety. */
function restQuaternion(value: number, yaw: number): THREE.Quaternion {
  const normal = new THREE.Vector3(...FACE_NORMALS[value]);
  const align = new THREE.Quaternion().setFromUnitVectors(normal, UP);
  const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  return yawQ.multiply(align);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface DieAnim {
  mesh: THREE.Mesh;
  startX: number;
  startZ: number;
  restX: number;
  restZ: number;
  spinAxis: THREE.Vector3;
  spinSpeed: number;
  spin: THREE.Quaternion;
  settleFrom: THREE.Quaternion | null;
  rest: THREE.Quaternion;
}

const ROLL_MS = 1150;
const SETTLE_MS = 700;
const REST_Y = 0.55;
const DIE = 1.05;
const REST_X = 0.85;

interface DiceRoll3DProps {
  dice: DicePair;
  roller: Color;
  myColor: Color;
}

export function DiceRoll3D({ dice, roller, myColor }: DiceRoll3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 320;
    const height = mount.clientHeight || 480;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(0, 9, 2.5);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 8, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe0a0, 0.5);
    rim.position.set(-4, 3, -2);
    scene.add(rim);

    // A soft shadow blob under each die (a plane with a radial-gradient
    // texture) sells the contact without a full shadow pass.
    const shadowTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(64, 64, 4, 64, 64, 60);
      grad.addColorStop(0, "rgba(0,0,0,0.45)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();

    const materials = FACE_VALUES.map(
      (v) =>
        new THREE.MeshStandardMaterial({
          map: faceTexture(v),
          roughness: 0.45,
          metalness: 0.05,
        }),
    );
    const geometry = new THREE.BoxGeometry(DIE, DIE, DIE);

    // Roll direction: the roller's dice sweep in from their own side.
    const fromNear = roller === myColor;
    const startZ = fromNear ? 3.5 : -3.5;

    const dice3d: DieAnim[] = dice.map((value, i) => {
      const mesh = new THREE.Mesh(geometry, materials);
      const restX = i === 0 ? -REST_X : REST_X;
      scene.add(mesh);

      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(DIE * 1.7, DIE * 1.7),
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          depthWrite: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(restX, 0.02, 0);
      scene.add(shadow);
      mesh.userData.shadow = shadow;

      // Deterministic-enough variety without Math.random dependence on
      // anything the server cares about.
      const seed = value * 7 + i * 13;
      const axis = new THREE.Vector3(
        Math.sin(seed) * 0.6 + 0.4,
        Math.cos(seed * 1.3),
        Math.sin(seed * 0.7) * 0.6 + 0.3,
      ).normalize();

      return {
        mesh,
        startX: -4 - i * 0.6,
        startZ,
        restX,
        restZ: 0,
        spinAxis: axis,
        spinSpeed: 14 + (i === 0 ? 0 : 2),
        spin: new THREE.Quaternion(),
        settleFrom: null,
        rest: restQuaternion(value, (i === 0 ? 0.25 : -0.3)),
      };
    });

    let raf = 0;
    const start = performance.now();
    const delta = new THREE.Quaternion();

    const frame = (now: number) => {
      const t = now - start;

      for (const d of dice3d) {
        if (t < ROLL_MS) {
          const p = t / ROLL_MS;
          const e = easeOutCubic(p);
          d.mesh.position.x = THREE.MathUtils.lerp(d.startX, d.restX, e);
          d.mesh.position.z = THREE.MathUtils.lerp(d.startZ, d.restZ, e);
          const bounce = Math.abs(Math.sin(p * Math.PI * 2.5)) * (1 - p) * 1.5;
          d.mesh.position.y = REST_Y + bounce;

          const dt = Math.min(0.05, (t > 16 ? 16 : t) / 1000);
          delta.setFromAxisAngle(d.spinAxis, d.spinSpeed * (1 - p) * dt);
          d.spin.multiply(delta);
          d.mesh.quaternion.copy(d.spin);
        } else {
          if (!d.settleFrom) d.settleFrom = d.mesh.quaternion.clone();
          const p = Math.min(1, (t - ROLL_MS) / SETTLE_MS);
          const e = easeOutCubic(p);
          d.mesh.quaternion.slerpQuaternions(d.settleFrom, d.rest, e);
          d.mesh.position.x = d.restX;
          d.mesh.position.z = 0;
          // Tiny landing settle.
          d.mesh.position.y = REST_Y + Math.max(0, Math.sin(p * Math.PI) * 0.12 * (1 - p) * 4 * (1 - e));
        }

        const shadow = d.mesh.userData.shadow as THREE.Mesh;
        shadow.position.x = d.mesh.position.x;
        const lift = d.mesh.position.y - REST_Y;
        const s = 1 - Math.min(0.5, lift * 0.25);
        shadow.scale.setScalar(s);
        (shadow.material as THREE.MeshBasicMaterial).opacity =
          0.9 * Math.max(0.3, 1 - lift * 0.4);
      }

      renderer.render(scene, camera);
      if (t < ROLL_MS + SETTLE_MS + 400) {
        raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      geometry.dispose();
      for (const m of materials) {
        m.map?.dispose();
        m.dispose();
      }
      shadowTex.dispose();
      for (const d of dice3d) {
        const shadow = d.mesh.userData.shadow as THREE.Mesh;
        shadow.geometry.dispose();
        (shadow.material as THREE.Material).dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [dice, roller, myColor]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-5">
        {dice.map((d, i) => (
          <DieFace key={i} value={d} size="lg" animateIn />
        ))}
      </div>
    );
  }

  return <div ref={mountRef} className="absolute inset-0" data-testid="dice-3d" />;
}
