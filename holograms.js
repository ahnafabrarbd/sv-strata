// Holographic 3D icons for SV STRATA — replaces the legacy SV-peninsula
// contour. Three icons keyed to the three layers:
//
//   faces    → wireframe humanoid mask (mint)
//   ideology → Obsidian-graph-style node lattice (neon green)
//   factory  → saw-tooth-roof factory with chimneys (deep emerald)
//
// All three render as green wireframes against a transparent background.
// Each can be embedded in its own canvas (mountHologram) or composed into
// an existing Three.js scene (buildHologram returns a THREE.Group).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const HOLO_COLORS = {
    faces:    0xc8ffd4,
    ideology: 0x44ff8c,
    factory:  0x009947
};

const DEFAULT_COLOR = 0x44ff8c;

// ---------- public API ----------

// Mount a self-contained hologram into a container element. Returns a handle
// with dispose() and the underlying OrbitControls. The container should
// already have a non-zero size.
export function mountHologram(container, kind, layerId, opts = {}) {
    const color = HOLO_COLORS[layerId] ?? DEFAULT_COLOR;

    const scene = new THREE.Scene();
    const w0 = Math.max(1, container.clientWidth);
    const h0 = Math.max(1, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(38, w0 / h0, 0.1, 100);
    camera.position.set(0, 0.4, 4.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w0, h0);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = opts.enableZoom ?? false;
    controls.enablePan = false;
    controls.autoRotate = opts.autoRotate ?? true;
    controls.autoRotateSpeed = opts.autoRotateSpeed ?? 0.7;
    controls.target.set(0, 0, 0);

    const group = buildHologram(kind, color);
    scene.add(group);

    const ro = new ResizeObserver(() => {
        const w = Math.max(1, container.clientWidth);
        const h = Math.max(1, container.clientHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });
    ro.observe(container);

    let raf = 0;
    let stopped = false;
    function tick() {
        if (stopped) return;
        controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
    }
    tick();

    return {
        scene, camera, renderer, controls, group,
        dispose() {
            stopped = true;
            cancelAnimationFrame(raf);
            ro.disconnect();
            scene.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
                    else o.material.dispose();
                }
            });
            renderer.dispose();
            if (renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            }
        }
    };
}

// Build the geometry group for a given hologram kind. Caller is responsible
// for adding it to a scene. Used by lattice.js to embed icons inside planes.
export function buildHologram(kind, color = DEFAULT_COLOR) {
    if (kind === 'mask')    return buildMask(color);
    if (kind === 'network') return buildNetwork(color);
    if (kind === 'factory') return buildFactory(color);
    return new THREE.Group();
}

// ---------- materials & helpers ----------

function lineMat(color, opacity = 0.95) {
    return new THREE.LineBasicMaterial({
        color, transparent: true, opacity, toneMapped: false
    });
}

function wireframe(geom, color, opacity) {
    return new THREE.LineSegments(new THREE.WireframeGeometry(geom), lineMat(color, opacity));
}

// ---------- mask ----------
function buildMask(color) {
    const g = new THREE.Group();

    // Skull: low-poly icosphere, slightly elongated forward.
    const skullGeom = new THREE.IcosahedronGeometry(1.15, 1);
    const skull = wireframe(skullGeom, color, 0.85);
    skull.scale.set(0.85, 1.05, 0.95);
    g.add(skull);

    // Eye sockets — two recessed wireframe spheres.
    [-0.42, 0.42].forEach(x => {
        const eye = wireframe(new THREE.SphereGeometry(0.18, 10, 8), color, 1);
        eye.position.set(x, 0.18, 0.78);
        g.add(eye);
    });

    // Pupils — small filled dots so the eyes "look" out.
    [-0.42, 0.42].forEach(x => {
        const pupil = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 8, 6),
            new THREE.MeshBasicMaterial({ color, toneMapped: false })
        );
        pupil.position.set(x, 0.18, 0.94);
        g.add(pupil);
    });

    // Nose — a forward-pointing wireframe pyramid.
    const noseGeom = new THREE.ConeGeometry(0.13, 0.42, 4);
    const nose = wireframe(noseGeom, color, 1);
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.position.set(0, -0.05, 0.92);
    g.add(nose);

    // Mouth — half-torus arc.
    const mouthGeom = new THREE.TorusGeometry(0.32, 0.04, 6, 18, Math.PI);
    const mouth = wireframe(mouthGeom, color, 1);
    mouth.rotation.z = Math.PI;          // open downward
    mouth.position.set(0, -0.5, 0.78);
    g.add(mouth);

    // Brow ridges — short curved lines above the eyes.
    [-0.42, 0.42].forEach(x => {
        const brow = wireframe(new THREE.TorusGeometry(0.22, 0.02, 4, 10, Math.PI * 0.6), color, 1);
        brow.rotation.x = Math.PI / 2;
        brow.position.set(x, 0.46, 0.7);
        g.add(brow);
    });

    return g;
}

// ---------- network ----------
function buildNetwork(color) {
    const g = new THREE.Group();
    const N = 18;

    // Deterministic PRNG so the graph looks the same every reload.
    let seed = 6173;
    const rand = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };

    const positions = [];
    for (let i = 0; i < N; i++) {
        // Spherical sampling biased toward the surface.
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(2 * rand() - 1);
        const r = 0.55 + rand() * 0.85;
        positions.push(new THREE.Vector3(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        ));
    }

    // Nodes: small filled icospheres so they read as solid points,
    // each wrapped in a wireframe shell for the holographic look.
    const filledMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, toneMapped: false });
    positions.forEach(p => {
        const filled = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), filledMat);
        filled.position.copy(p);
        g.add(filled);
        const shell = wireframe(new THREE.IcosahedronGeometry(0.10, 0), color, 0.9);
        shell.position.copy(p);
        g.add(shell);
    });

    // Edges: each node to its 2 nearest neighbours, deduped.
    const seen = new Set();
    const verts = [];
    positions.forEach((p, i) => {
        const ranked = positions
            .map((q, j) => ({ j, d: p.distanceTo(q) }))
            .filter(o => o.j !== i)
            .sort((a, b) => a.d - b.d)
            .slice(0, 2);
        ranked.forEach(({ j }) => {
            const key = i < j ? i + ':' + j : j + ':' + i;
            if (seen.has(key)) return;
            seen.add(key);
            verts.push(p.x, p.y, p.z, positions[j].x, positions[j].y, positions[j].z);
        });
    });
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.add(new THREE.LineSegments(edgeGeom, lineMat(color, 0.7)));

    return g;
}

// ---------- factory ----------
function buildFactory(color) {
    const g = new THREE.Group();

    // Main building.
    const base = wireframe(new THREE.BoxGeometry(2.2, 1.0, 1.4), color, 1);
    base.position.y = 0;
    g.add(base);

    // Saw-tooth roof — three north-light pyramids running across the top.
    for (let i = 0; i < 3; i++) {
        const x = -0.7 + i * 0.7;
        const tooth = wireframe(new THREE.ConeGeometry(0.36, 0.34, 4), color, 1);
        tooth.rotation.y = Math.PI / 4;
        tooth.position.set(x, 0.67, 0);
        g.add(tooth);
    }

    // Two chimneys at the back, with belted bands.
    [-0.75, 0.75].forEach(x => {
        const chimney = wireframe(new THREE.CylinderGeometry(0.13, 0.16, 0.85, 10), color, 1);
        chimney.position.set(x, 0.92, -0.45);
        g.add(chimney);

        // Belted bands — three rings around each chimney for that
        // industrial-illustration silhouette.
        for (let k = 0; k < 3; k++) {
            const band = wireframe(new THREE.TorusGeometry(0.15, 0.018, 6, 12), color, 1);
            band.rotation.x = Math.PI / 2;
            band.position.set(x, 0.65 + k * 0.27, -0.45);
            g.add(band);
        }
    });

    // Smoke rings rising above each chimney — three per stack, expanding.
    [-0.75, 0.75].forEach(x => {
        for (let k = 0; k < 3; k++) {
            const r = 0.10 + k * 0.05;
            const ring = wireframe(new THREE.TorusGeometry(r, 0.012, 4, 12), color, 0.8 - k * 0.18);
            ring.rotation.x = Math.PI / 2;
            ring.position.set(x, 1.45 + k * 0.22, -0.45);
            g.add(ring);
        }
    });

    // Door + windows on the front face.
    const door = wireframe(new THREE.BoxGeometry(0.3, 0.5, 0.04), color, 1);
    door.position.set(0, -0.25, 0.72);
    g.add(door);
    [-0.55, 0.55].forEach(x => {
        const win = wireframe(new THREE.BoxGeometry(0.4, 0.28, 0.04), color, 1);
        win.position.set(x, 0.05, 0.72);
        g.add(win);

        // Window cross.
        const cross1 = wireframe(new THREE.BoxGeometry(0.4, 0.02, 0.05), color, 0.7);
        cross1.position.set(x, 0.05, 0.73);
        g.add(cross1);
        const cross2 = wireframe(new THREE.BoxGeometry(0.02, 0.28, 0.05), color, 0.7);
        cross2.position.set(x, 0.05, 0.73);
        g.add(cross2);
    });

    // Centre the whole thing vertically so it orbits around its midpoint.
    g.position.y = -0.4;
    return g;
}
