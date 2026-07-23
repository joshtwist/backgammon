import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Color, DicePair, Die } from "../../shared/types.ts";
import { DieFace } from "./Dice.tsx";

/**
 * WebGL dice-roll theater: two rounded 3D dice spin in with a showy,
 * even, slot-machine flourish and stop FLAT with the (server-authoritative)
 * value straight up.
 *
 * The spin is a single, even rotation about a horizontal axis (deliberately
 * unrealistic — more "one-armed bandit" than dice tumbling on felt). It's
 * solved so it can never need a correction: the resting orientation is
 * fixed (value up, square), and we spin *backwards* from there by a whole
 * number of quarter-turns. Rotating a cube by 90° multiples about a
 * principal axis keeps it square, so it lands dead flat on the correct
 * face with no end slerp. The reveal then holds so you can read it, and
 * fades out in place (the values remain visible in the tray below).
 *
 * Falls back to flat 2D dice if a WebGL context can't be created.
 */

// Value → the local face-normal that value's pips sit on. Opposite faces
// sum to 7.
const FACE_NORMALS: Record<number, [number, number, number]> = {
  1: [1, 0, 0],
  6: [-1, 0, 0],
  2: [0, 1, 0],
  5: [0, -1, 0],
  3: [0, 0, 1],
  4: [0, 0, -1],
};

// In-plane basis (u, v) per face, for laying pips out on a 3×3 grid.
const FACE_BASIS: Record<number, { u: [number, number, number]; v: [number, number, number] }> = {
  1: { u: [0, 1, 0], v: [0, 0, 1] },
  6: { u: [0, 1, 0], v: [0, 0, 1] },
  2: { u: [1, 0, 0], v: [0, 0, 1] },
  5: { u: [1, 0, 0], v: [0, 0, 1] },
  3: { u: [1, 0, 0], v: [0, 1, 0] },
  4: { u: [1, 0, 0], v: [0, 1, 0] },
};

// Grid cells (0..8, row-major) lit for each value.
const PIP_CELLS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const UP = new THREE.Vector3(0, 1, 0);
// Even spin about a horizontal axis (reel-like).
const SPIN_AXIS = new THREE.Vector3(1, 0, 0);

/** Quaternion that rests `value` dead flat, face-up and square. */
function restQuaternion(value: number): THREE.Quaternion {
  const normal = new THREE.Vector3(...FACE_NORMALS[value]);
  return new THREE.Quaternion().setFromUnitVectors(normal, UP);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Even spin: near-constant angular velocity for most of the roll, then a
 * quick ease into the stop — reads like a reel spinning down, not a thrown
 * die decelerating the whole way.
 */
function spinEase(t: number): number {
  const k = 0.7; // even/linear portion
  if (t < k) return (t / k) * 0.85;
  const u = (t - k) / (1 - k);
  return 0.85 + easeOutCubic(u) * 0.15;
}

const DIE = 1.0;
const REST_X = 0.85;
const ROLL_MS = 950;
const HALF_PI = Math.PI / 2;

interface DieAnim {
  mesh: THREE.Object3D;
  restX: number;
  startZ: number;
  total: number;
  qStart: THREE.Quaternion;
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
    camera.position.set(0, 7.6, 2.3);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 8, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe6b0, 0.55);
    rim.position.set(-4, 4, -3);
    scene.add(rim);

    // ── Shared geometry / materials ──────────────────────────────────
    const bodyGeo = new RoundedBoxGeometry(DIE, DIE, DIE, 5, DIE * 0.16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf4eddc,
      roughness: 0.32,
      metalness: 0.06,
    });
    // Pips are thin flat discs (not spheres) so they lie on the plane of
    // the face, proud by just a hair so they still catch the light.
    const pipGeo = new THREE.CylinderGeometry(
      DIE * 0.072,
      DIE * 0.072,
      DIE * 0.03,
      20,
    );
    const pipMat = new THREE.MeshStandardMaterial({
      color: 0x27272f,
      roughness: 0.5,
    });

    const spacing = DIE * 0.25;
    const PIP_UP = new THREE.Vector3(0, 1, 0);

    /** Build one die: rounded body + flat disc pips on all six faces. */
    function makeDie(): THREE.Object3D {
      const die = new THREE.Mesh(bodyGeo, bodyMat);
      for (let value = 1; value <= 6; value++) {
        const n = new THREE.Vector3(...FACE_NORMALS[value]);
        const u = new THREE.Vector3(...FACE_BASIS[value].u);
        const v = new THREE.Vector3(...FACE_BASIS[value].v);
        for (const cell of PIP_CELLS[value]) {
          const col = (cell % 3) - 1;
          const row = Math.floor(cell / 3) - 1;
          const pip = new THREE.Mesh(pipGeo, pipMat);
          // A cylinder's axis is +Y; align it to the face normal so the
          // disc lies flat on the face, round side out.
          pip.quaternion.setFromUnitVectors(PIP_UP, n);
          // Sit essentially on the plane, proud by a hair.
          pip.position
            .copy(n)
            .multiplyScalar(DIE * 0.5 + DIE * 0.004)
            .addScaledVector(u, col * spacing)
            .addScaledVector(v, row * spacing);
          die.add(pip);
        }
      }
      return die;
    }

    const entrySign = roller === myColor ? 1 : -1;

    const dice3d: DieAnim[] = (dice as readonly Die[]).map((value, i) => {
      const mesh = makeDie();
      const restX = i === 0 ? -REST_X : REST_X;
      scene.add(mesh);

      // A lively but even number of quarter-turns; only the count varies.
      const quarters = 8 + Math.floor(Math.random() * 4) + i; // 8..12
      const total = quarters * HALF_PI;
      const rest = restQuaternion(value);
      const qStart = new THREE.Quaternion()
        .setFromAxisAngle(SPIN_AXIS, -total)
        .multiply(rest);

      return { mesh, restX, startZ: entrySign * 2.4, total, qStart };
    });

    let raf = 0;
    const start = performance.now();
    const spin = new THREE.Quaternion();

    const frame = (now: number) => {
      const t = now - start;
      const rolling = Math.min(1, t / ROLL_MS);
      const e = spinEase(rolling);

      for (const d of dice3d) {
        // Even spin that always ends square on the value.
        spin.setFromAxisAngle(SPIN_AXIS, d.total * e);
        d.mesh.quaternion.copy(spin).multiply(d.qStart);

        // Quick scale-in, small slide from the roller's side, then hold.
        const intro = Math.min(1, t / 200);
        const slide = easeOutCubic(Math.min(1, t / (ROLL_MS * 0.4)));
        d.mesh.position.set(
          d.restX,
          0,
          THREE.MathUtils.lerp(d.startZ, 0, slide),
        );
        // A tiny landing pop as it settles.
        const pop =
          t > ROLL_MS && t < ROLL_MS + 160
            ? 1 + Math.sin(((t - ROLL_MS) / 160) * Math.PI) * 0.08
            : 1;
        d.mesh.scale.setScalar((0.5 + 0.5 * easeOutCubic(intro)) * pop);
      }

      renderer.render(scene, camera);
      // Keep rendering through the hold so it sits crisp until it fades.
      if (t < ROLL_MS + 1600) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      bodyGeo.dispose();
      bodyMat.dispose();
      pipGeo.dispose();
      pipMat.dispose();
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
