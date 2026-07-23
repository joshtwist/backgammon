import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Color, DicePair, Die } from "../../shared/types.ts";
import { DieFace } from "./Dice.tsx";

/**
 * WebGL dice-roll theater: two 3D dice roll in from off-screen and settle
 * FLAT with the (server-authoritative) rolled value straight up.
 *
 * The motion is a genuine roll, solved so it can never need a correction:
 * the resting orientation is fixed (value up, square), and we roll the die
 * *backwards* from there by a whole number of quarter-turns about a
 * horizontal axis. Rotating an axis-aligned cube by 90° multiples about a
 * principal horizontal axis keeps it axis-aligned, so the die is square at
 * every quarter-turn and lands dead flat on the correct face — no end
 * slerp. Position and rotation share the same eased progress, so the die
 * rolls (rather than glides) to a stop, and its centre bobs up on each
 * edge-pivot the way a real die does. Only the off-screen start distance
 * is randomised, so every roll reads consistently but never identically.
 *
 * Falls back to flat 2D dice if a WebGL context can't be created.
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

function faceTexture(value: number): THREE.CanvasTexture {
  const S = 160;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#f4eddc";
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
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
// Tumble axis: horizontal, along +X. Dice roll along Z (toward the board
// centre), pivoting over this axis — a principal axis, so 90° multiples
// keep the cube square.
const TUMBLE_AXIS = new THREE.Vector3(1, 0, 0);

/** Quaternion that rests `value` dead flat, face-up and square. */
function restQuaternion(value: number): THREE.Quaternion {
  const normal = new THREE.Vector3(...FACE_NORMALS[value]);
  return new THREE.Quaternion().setFromUnitVectors(normal, UP);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const DIE = 0.98;
const REST_Y = DIE / 2; // sitting on the felt at y = 0
const REST_X = 0.82;
const ROLL_MS = 700;
const POP_MS = 150;
const HALF_PI = Math.PI / 2;

interface DieAnim {
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  restX: number;
  startZ: number;
  total: number; // signed total tumble angle (a multiple of 90°)
  qStart: THREE.Quaternion;
  tmp: THREE.Quaternion;
}

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
    // Fairly top-down so a flat die reads as "value straight up", with just
    // enough tilt to keep the 3D form legible.
    camera.position.set(0, 9.4, 1.9);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 9, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe0a0, 0.5);
    rim.position.set(-4, 3, -2);
    scene.add(rim);

    const shadowTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(64, 64, 4, 64, 64, 60);
      grad.addColorStop(0, "rgba(0,0,0,0.5)");
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
          roughness: 0.4,
          metalness: 0.04,
        }),
    );
    const geometry = new THREE.BoxGeometry(DIE, DIE, DIE);

    // Dice roll in from the roller's edge of the board toward the centre.
    const entrySign = roller === myColor ? 1 : -1;

    const dice3d: DieAnim[] = (dice as readonly Die[]).map((value, i) => {
      const mesh = new THREE.Mesh(geometry, materials);
      const restX = i === 0 ? -REST_X : REST_X;
      scene.add(mesh);

      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(DIE * 1.6, DIE * 1.6),
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          depthWrite: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(restX, 0.02, 0);
      scene.add(shadow);

      // Randomise only the off-screen start distance → how far it rolls.
      const dist = 5.5 + Math.random() * 2.5;
      const startZ = entrySign * dist;
      // Whole quarter-turns matched to the distance so it rolls (no slide).
      const quarters = Math.max(4, Math.round(dist / DIE));
      // Rolling toward the centre (−entrySign in Z) tumbles this way:
      const total = -entrySign * quarters * HALF_PI;
      const rest = restQuaternion(value);
      const qStart = new THREE.Quaternion()
        .setFromAxisAngle(TUMBLE_AXIS, -total)
        .multiply(rest);

      return { mesh, shadow, restX, startZ, total, qStart, tmp: new THREE.Quaternion() };
    });

    let raf = 0;
    const start = performance.now();
    const spin = new THREE.Quaternion();

    const frame = (now: number) => {
      const t = now - start;
      const rolling = Math.min(1, t / ROLL_MS);
      const e = easeOutCubic(rolling);

      for (const d of dice3d) {
        // Orientation: fixed tumble, always ending square on the value.
        spin.setFromAxisAngle(TUMBLE_AXIS, d.total * e);
        d.mesh.quaternion.copy(spin).multiply(d.qStart);

        // Position rolls in lockstep with the rotation (shared `e`).
        d.mesh.position.x = d.restX;
        d.mesh.position.z = THREE.MathUtils.lerp(d.startZ, 0, e);

        // Authentic edge-pivot bob: centre rises toward each 45° then
        // drops flat again at every quarter-turn, and is exactly flat at
        // the end (angle is a whole multiple of 90°).
        const ang = Math.abs(d.total) * e;
        const w = ang % HALF_PI;
        const bob = (DIE / 2) * (Math.cos(w) + Math.sin(w)) - DIE / 2;
        d.mesh.position.y = REST_Y + bob;

        // A quick squash-pop on landing.
        if (t > ROLL_MS && t < ROLL_MS + POP_MS) {
          const pop = 1 + Math.sin(((t - ROLL_MS) / POP_MS) * Math.PI) * 0.11;
          d.mesh.scale.set(pop, 1 / pop, pop);
        } else {
          d.mesh.scale.setScalar(1);
        }

        const lift = d.mesh.position.y - REST_Y;
        d.shadow.position.z = d.mesh.position.z;
        d.shadow.scale.setScalar(1 - Math.min(0.5, lift * 0.4));
        (d.shadow.material as THREE.MeshBasicMaterial).opacity =
          0.9 * Math.max(0.3, 1 - lift * 0.7);
      }

      renderer.render(scene, camera);
      if (t < ROLL_MS + 900) raf = requestAnimationFrame(frame);
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
        d.shadow.geometry.dispose();
        (d.shadow.material as THREE.Material).dispose();
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

  return (
    <div ref={mountRef} className="absolute inset-0" data-testid="dice-3d" />
  );
}

export default DiceRoll3D;
