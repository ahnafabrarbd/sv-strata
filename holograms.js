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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const HOLO_COLORS = {
    faces:    0x8fd9a6,
    ideology: 0x2dcc66,
    factory:  0x0f5d36
};

const DEFAULT_COLOR = 0x2dcc66;

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
    camera.position.set(0, 0.15, 5.2);

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
// Real open-source 3D head model (Lee Perry Smith, CC-BY 3.0, hosted by
// the three.js examples) rendered as a pure green wireframe — gives the
// "biometric scan grid" look the reference image was after, instead of
// trying to fake facial topology procedurally. The GLB lives on
// threejs.org; the first page that needs it triggers the fetch and
// every subsequent buildMask call reuses the cached geometry.

const HEAD_MODEL_URL =
    'https://threejs.org/examples/models/gltf/LeePerrySmith/LeePerrySmith.glb';

let _headGeomPromise = null;
function loadHeadGeometry() {
    if (_headGeomPromise) return _headGeomPromise;
    const loader = new GLTFLoader();
    _headGeomPromise = new Promise((resolve, reject) => {
        loader.load(HEAD_MODEL_URL, (gltf) => {
            // Lee Perry Smith ships as one mesh in the scene root; grab it
            // and hand back the geometry. We deliberately throw away the
            // material — wireframe rendering is the whole point.
            let geom = null;
            gltf.scene.traverse(o => {
                if (o.isMesh && !geom) geom = o.geometry;
            });
            if (!geom) {
                reject(new Error('No mesh found in head model'));
                return;
            }
            resolve(geom);
        }, undefined, reject);
    });
    return _headGeomPromise;
}

function buildMaskPlaceholder(color) {
    // Faint icosphere so the canvas isn't empty during the GLB fetch.
    const placeholder = wireframe(new THREE.IcosahedronGeometry(0.6, 2), color, 0.25);
    placeholder.scale.set(0.86, 1.10, 0.96);
    placeholder.position.set(0, 0.10, 0);
    return placeholder;
}

// Build a wireframe LineSegments from a head-style geometry, keeping only
// the triangles whose normal points outward from the bounding-box centre.
// This strips the interior anatomy (mouth cavity, tongue, gum walls,
// nostril walls) that an ordinary WireframeGeometry would otherwise
// expose, since wireframes don't occlude.
function outwardWireframe(geom, color, opacity = 0.85) {
    geom.computeBoundingBox();
    const centre = new THREE.Vector3();
    geom.boundingBox.getCenter(centre);

    const pos = geom.attributes.position;
    const idx = geom.index;
    if (!pos || !idx) {
        return new THREE.LineSegments(new THREE.WireframeGeometry(geom), lineMat(color, opacity));
    }

    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const v3 = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const triN = new THREE.Vector3();
    const triC = new THREE.Vector3();
    const radial = new THREE.Vector3();

    const verts = [];
    const triCount = idx.count / 3;
    for (let t = 0; t < triCount; t++) {
        const a = idx.getX(t * 3);
        const b = idx.getX(t * 3 + 1);
        const c = idx.getX(t * 3 + 2);
        v1.fromBufferAttribute(pos, a);
        v2.fromBufferAttribute(pos, b);
        v3.fromBufferAttribute(pos, c);

        e1.subVectors(v2, v1);
        e2.subVectors(v3, v1);
        triN.crossVectors(e1, e2).normalize();

        triC.copy(v1).add(v2).add(v3).multiplyScalar(1 / 3);
        radial.subVectors(triC, centre).normalize();

        // Keep triangles whose normal points outward (away from the head's
        // centre). A small positive threshold catches glancing faces too,
        // so silhouette edges don't get culled.
        if (triN.dot(radial) > 0.05) {
            verts.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
            verts.push(v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
            verts.push(v3.x, v3.y, v3.z, v1.x, v1.y, v1.z);
        }
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return new THREE.LineSegments(out, lineMat(color, opacity));
}

function buildMask(color) {
    const g = new THREE.Group();

    // Render the head wireframe substantially darker than the rest of the
    // page's faces accent — multiplying the input colour by 0.40 takes the
    // sage down to a deep moss, and the lower line opacity means the grid
    // never overpowers the dark background.
    const headColor = new THREE.Color(color).multiplyScalar(0.40).getHex();

    // Placeholder while the GLB fetches.
    const placeholder = buildMaskPlaceholder(headColor);
    g.add(placeholder);

    loadHeadGeometry().then(geom => {
        g.remove(placeholder);
        placeholder.geometry.dispose();
        placeholder.material.dispose();

        const wireMesh = outwardWireframe(geom, headColor, 0.55);

        // Frame the head 1.6 units tall and centre it on the origin —
        // works regardless of the model's native scale or pivot.
        geom.computeBoundingBox();
        const box = geom.boundingBox;
        const size = new THREE.Vector3();
        const centre = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(centre);
        const s = 1.6 / Math.max(size.y, 0.001);
        wireMesh.scale.setScalar(s);
        wireMesh.position.set(-centre.x * s, -centre.y * s, -centre.z * s);

        g.add(wireMesh);
    }).catch(err => {
        console.warn('[holograms] head model load failed:', err);
    });

    return g;
}

// ---------- network ----------
// Dense character-graph (think of the GoT relationship-network style):
// ~110 nodes of varying size, biased toward an inner cluster, each wired
// to its 3–4 nearest neighbours plus an occasional long-distance link.
function buildNetwork(color) {
    const g = new THREE.Group();
    const N = 170;

    // Deterministic PRNG so the graph looks the same every reload.
    let seed = 6173;
    const rand = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };

    const positions = [];
    for (let i = 0; i < N; i++) {
        // 70% nodes inside the dense cluster, 30% trailing to the periphery.
        const r = (rand() < 0.7 ? 0.25 + rand() * 0.65 : 0.95 + rand() * 0.55);
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(2 * rand() - 1);
        positions.push(new THREE.Vector3(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        ));
    }

    // Variable node sizes — a handful of "main characters" stand out.
    const sizes = positions.map(() => {
        const r = rand();
        if (r < 0.06) return 0.11;
        if (r < 0.25) return 0.07;
        return 0.04;
    });

    const filledMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.78, toneMapped: false
    });
    positions.forEach((p, i) => {
        const node = new THREE.Mesh(new THREE.IcosahedronGeometry(sizes[i], 0), filledMat);
        node.position.copy(p);
        g.add(node);
    });

    // Edges: dense — each node to its 3–4 nearest neighbours, plus a 15%
    // chance of a single long-distance jumper that skips across the graph.
    const seen = new Set();
    const verts = [];
    positions.forEach((p, i) => {
        const ranked = positions
            .map((q, j) => ({ j, d: p.distanceTo(q) }))
            .filter(o => o.j !== i)
            .sort((a, b) => a.d - b.d);
        const k = 3 + Math.floor(rand() * 2);
        ranked.slice(0, k).forEach(({ j }) => {
            const key = i < j ? i + ':' + j : j + ':' + i;
            if (seen.has(key)) return;
            seen.add(key);
            verts.push(p.x, p.y, p.z, positions[j].x, positions[j].y, positions[j].z);
        });
        if (rand() < 0.15) {
            const j = Math.floor(rand() * N);
            const key = i < j ? i + ':' + j : j + ':' + i;
            if (j !== i && !seen.has(key)) {
                seen.add(key);
                verts.push(p.x, p.y, p.z, positions[j].x, positions[j].y, positions[j].z);
            }
        }
    });
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.add(new THREE.LineSegments(edgeGeom, lineMat(color, 0.42)));

    return g;
}

// ---------- factory ----------
// Industrial complex modelled on a cement / processing plant — rough,
// rugged, cluttered. Foundation slab + perimeter fence; twin silos with
// caps, ladders, and floor markings; a multi-storey lattice tower with
// X-bracing, internal floors, catwalks, and a side mast; twin exhaust
// chimneys with cap rims; a trunk pipeline running across the top;
// secondary pipework feeding the chimneys; and an angled conveyor belt
// climbing into one of the silos.
function buildFactory(color) {
    const g = new THREE.Group();

    // ----- foundation slab + low perimeter -----
    const slab = wireframe(new THREE.BoxGeometry(3.20, 0.16, 1.95), color, 0.55);
    slab.position.y = -1.05;
    g.add(slab);

    // Perimeter fence — short repeating posts along the front edge.
    for (let k = 0; k < 12; k++) {
        const x = -1.40 + k * 0.255;
        const post = wireframe(new THREE.BoxGeometry(0.020, 0.18, 0.020), color, 0.45);
        post.position.set(x, -0.88, 0.94);
        g.add(post);
    }
    // Fence rail.
    const rail = wireframe(new THREE.BoxGeometry(2.80, 0.018, 0.018), color, 0.4);
    rail.position.set(0, -0.82, 0.94);
    g.add(rail);

    // ----- twin silos (left side) -----
    [-1.10, -0.58].forEach((x, i) => {
        const h = 1.55 - i * 0.10;
        const yBase = -0.96;

        const silo = wireframe(new THREE.CylinderGeometry(0.27, 0.27, h, 14), color, 1);
        silo.position.set(x, yBase + h / 2, 0.20);
        g.add(silo);

        // Hemispherical cap.
        const cap = wireframe(
            new THREE.SphereGeometry(0.27, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            color, 0.9
        );
        cap.position.set(x, yBase + h, 0.20);
        g.add(cap);

        // Belt bands.
        for (let k = 1; k <= 4; k++) {
            const band = wireframe(new THREE.TorusGeometry(0.28, 0.012, 4, 14), color, 0.6);
            band.rotation.x = Math.PI / 2;
            band.position.set(x, yBase + (k * h) / 5, 0.20);
            g.add(band);
        }

        // Vertical ladder running up the front of the silo.
        for (let k = 0; k < 8; k++) {
            const rung = wireframe(new THREE.BoxGeometry(0.06, 0.012, 0.012), color, 0.55);
            rung.position.set(x - 0.22, yBase + 0.10 + k * (h - 0.20) / 8, 0.30);
            g.add(rung);
        }
        // Ladder rails.
        [-0.025, 0.025].forEach(dy => {
            const railR = wireframe(new THREE.BoxGeometry(0.012, h - 0.20, 0.012), color, 0.4);
            railR.position.set(x - 0.25 + dy, yBase + h / 2, 0.30);
            g.add(railR);
        });
    });

    // Catwalk linking the silos at mid-height.
    const catwalkSilo = wireframe(new THREE.BoxGeometry(0.55, 0.020, 0.10), color, 0.5);
    catwalkSilo.position.set(-0.84, -0.20, 0.32);
    g.add(catwalkSilo);

    // ----- central tall tower frame -----
    const towerH = 2.20;
    const towerY = -0.96 + towerH / 2;
    const tower = wireframe(new THREE.BoxGeometry(0.78, towerH, 0.78), color, 0.95);
    tower.position.set(0.55, towerY, 0);
    g.add(tower);

    // X-bracing through the tower.
    [Math.PI / 4, -Math.PI / 4].forEach(a => {
        const brace = wireframe(new THREE.BoxGeometry(0.78, towerH, 0.02), color, 0.4);
        brace.rotation.y = a;
        brace.position.set(0.55, towerY, 0);
        g.add(brace);
    });

    // Internal floors at evenly spaced heights.
    for (let k = 1; k < 6; k++) {
        const floor = wireframe(new THREE.BoxGeometry(0.78, 0.02, 0.78), color, 0.5);
        floor.position.set(0.55, -0.96 + (k * towerH) / 6, 0);
        g.add(floor);
    }

    // External catwalks wrapping the tower at two heights.
    [-0.30, 0.40].forEach(yLevel => {
        const ring = wireframe(new THREE.TorusGeometry(0.55, 0.012, 4, 22), color, 0.5);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0.55, yLevel, 0);
        g.add(ring);
    });

    // Side mast — a thinner antenna-style pole rising off the tower.
    const mast = wireframe(new THREE.CylinderGeometry(0.020, 0.020, 0.85, 8), color, 0.7);
    mast.position.set(0.20, towerY + towerH / 2 + 0.20, 0.35);
    g.add(mast);
    // Mast cap dot.
    const mastTip = new THREE.Mesh(
        new THREE.SphereGeometry(0.030, 8, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, toneMapped: false })
    );
    mastTip.position.set(0.20, towerY + towerH / 2 + 0.65, 0.35);
    g.add(mastTip);

    // ----- twin exhaust chimneys (right) -----
    [{ x: 1.30, h: 1.60 }, { x: 1.58, h: 1.30 }].forEach(({ x, h }) => {
        const yBase = -0.96;

        const stack = wireframe(new THREE.CylinderGeometry(0.16, 0.18, h, 12), color, 1);
        stack.position.set(x, yBase + h / 2, 0.35);
        g.add(stack);

        for (let k = 1; k < 4; k++) {
            const band = wireframe(new THREE.TorusGeometry(0.17, 0.012, 4, 12), color, 0.55);
            band.rotation.x = Math.PI / 2;
            band.position.set(x, yBase + (k * h) / 4, 0.35);
            g.add(band);
        }

        // Cap rim — flared lip at the top.
        const lip = wireframe(new THREE.TorusGeometry(0.20, 0.020, 4, 14), color, 0.85);
        lip.rotation.x = Math.PI / 2;
        lip.position.set(x, yBase + h + 0.02, 0.35);
        g.add(lip);
    });

    // Cross-pipe running between the two chimneys mid-height.
    const chimneyLink = wireframe(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 8), color, 0.7);
    chimneyLink.rotation.z = Math.PI / 2;
    chimneyLink.position.set(1.44, 0.10, 0.35);
    g.add(chimneyLink);

    // ----- top trunk pipeline -----
    // Long horizontal cylinder running from the silos across the tower
    // and down toward the chimneys.
    const trunkLen = 2.30;
    const trunk = wireframe(new THREE.CylinderGeometry(0.10, 0.10, trunkLen, 10), color, 0.85);
    trunk.rotation.z = Math.PI / 2;
    trunk.position.set(0.20, 0.86, -0.18);
    g.add(trunk);

    // Pipe-bend down to one of the chimneys.
    const bend = wireframe(new THREE.TorusGeometry(0.18, 0.05, 6, 12, Math.PI / 2), color, 0.85);
    bend.rotation.x = Math.PI / 2;
    bend.rotation.z = -Math.PI / 2;
    bend.position.set(1.36, 0.86, -0.18);
    g.add(bend);

    // Vertical drop pipe to the chimney top.
    const drop = wireframe(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 8), color, 0.85);
    drop.position.set(1.36, 0.55, 0.0);
    g.add(drop);

    // ----- exhaust horn (curved big pipe at the top of the tower) -----
    const horn = wireframe(new THREE.TorusGeometry(0.32, 0.07, 8, 18, Math.PI), color, 0.95);
    horn.rotation.x = Math.PI / 2;
    horn.rotation.z = Math.PI;
    horn.position.set(0.55, 1.35, 0);
    g.add(horn);

    // ----- angled conveyor belt feeding the front silo -----
    // A long, narrow rectangular box slanted from ground to the top of
    // the silo cluster, with a few perpendicular cross-beams suggesting
    // the belt-frame trusses.
    const conveyorLen = 1.70;
    const conveyor = wireframe(new THREE.BoxGeometry(conveyorLen, 0.10, 0.18), color, 0.85);
    conveyor.rotation.z = Math.PI * 0.18;
    conveyor.position.set(-0.30, -0.45, 0.55);
    g.add(conveyor);

    // Conveyor underframe — a thinner parallel box below.
    const conveyorFrame = wireframe(new THREE.BoxGeometry(conveyorLen, 0.020, 0.18), color, 0.45);
    conveyorFrame.rotation.z = Math.PI * 0.18;
    conveyorFrame.position.set(-0.30, -0.55, 0.55);
    g.add(conveyorFrame);

    // Conveyor truss cross-beams — thin diagonal lines at intervals.
    for (let k = 0; k < 5; k++) {
        const t = k / 4;
        const cx = -0.30 + (t - 0.5) * conveyorLen * Math.cos(Math.PI * 0.18);
        const cy = -0.50 + (t - 0.5) * conveyorLen * Math.sin(Math.PI * 0.18);
        const cb = wireframe(new THREE.BoxGeometry(0.018, 0.10, 0.020), color, 0.4);
        cb.position.set(cx, cy, 0.55);
        g.add(cb);
    }

    // Pull the whole assembly down a touch so it orbits around its centre.
    g.position.y = 0.05;
    return g;
}
