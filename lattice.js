// 3D mind-lattice for SV STRATA.
// Planes are stacked horizontally in 3D space; each plane carries
// nodes; edges can connect any two nodes — same plane or across planes.
// Free Z-nodes float between planes (planeId === null) so the Z-axis
// itself can carry notes that pierce the strata.
// Reverse-Obsidian: drop nodes fast, then click in to fill them.
// Edges carry an optional label rendered as a sprite at their midpoint
// — click the edge in 3D to edit the label, shift-click to delete.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildHologram, HOLO_COLORS } from './holograms.js';

(function () {
'use strict';

// ---------- constants ----------
const STORAGE_KEY = 'sv-strata.lattice';
const PLANE_W = 720;
const PLANE_H = 720;
const PLANE_GAP = 360;
const NODE_R = 7;
const FREE_NODE_R = 9;
const FREE_NODE_COLOR = '#e8ffe8';

const PLANE_PALETTE = ['#a3d977', '#7dd3fc', '#c084fc', '#f472b6', '#fde047', '#22d3ee'];

function defaultState() {
    return {
        planes: [
            { id: 'plane_faces',    label: 'FACES',    y:  PLANE_GAP, color: '#c8ffd4', linkedLayer: 'faces' },
            { id: 'plane_ideology', label: 'IDEOLOGY', y:  0,         color: '#44ff8c', linkedLayer: 'ideology' },
            { id: 'plane_factory',  label: 'FACTORY',  y: -PLANE_GAP, color: '#009947', linkedLayer: 'factory' }
        ],
        nodes: [],
        edges: []
    };
}

function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    try {
        const s = JSON.parse(raw);
        if (!Array.isArray(s.planes) || !Array.isArray(s.nodes) || !Array.isArray(s.edges)) {
            return defaultState();
        }
        return s;
    } catch (e) {
        return defaultState();
    }
}

function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const state = loadState();
let selectedId = null;
let pendingFromId = null;
let connectMode = false;

// ---------- node-shape helpers ----------
function isFreeNode(n) {
    return n.planeId === null || n.planeId === undefined;
}

function nodeAbsoluteY(n) {
    if (isFreeNode(n)) return (typeof n.y === 'number') ? n.y : 0;
    const plane = state.planes.find(p => p.id === n.planeId);
    return plane ? plane.y : 0;
}

function nodeColor(n) {
    if (isFreeNode(n)) return FREE_NODE_COLOR;
    const plane = state.planes.find(p => p.id === n.planeId);
    return plane ? plane.color : '#44ff8c';
}

// ---------- per-layer hologram ----------
// Each plane carries the holographic icon for its linked layer (the same
// mask / network / factory geometries used on the index page). Built once
// per kind and cloned into each plane group so we never duplicate buffers.
const HOLO_KIND_BY_LAYER = { faces: 'mask', ideology: 'network', factory: 'factory' };
const HOLO_SCALE = 90;     // world-units per hologram unit
const HOLO_LIFT  = 24;     // hover the icon slightly above the plane

function holoForPlane(plane) {
    const kind = HOLO_KIND_BY_LAYER[plane.linkedLayer];
    if (!kind) return null;
    const color = HOLO_COLORS[plane.linkedLayer] ?? new THREE.Color(plane.color).getHex();
    const group = buildHologram(kind, color);
    group.scale.setScalar(HOLO_SCALE);
    group.position.y = HOLO_LIFT;
    // Make the in-plane hologram very faint so it sits behind nodes.
    group.traverse(o => {
        if (o.material) {
            const apply = (m) => {
                m.transparent = true;
                m.opacity = (m.opacity ?? 1) * 0.22;
                m.depthWrite = false;
            };
            if (Array.isArray(o.material)) o.material.forEach(apply);
            else apply(o.material);
        }
    });
    return group;
}

// ---------- three.js ----------
const container = document.getElementById('canvas3d');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03100a);
scene.fog = new THREE.Fog(0x03100a, 1100, 3200);

const camera = new THREE.PerspectiveCamera(
    42,
    container.clientWidth / container.clientHeight,
    1,
    6000
);
camera.position.set(820, 580, 1080);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.minDistance = 200;
controls.maxDistance = 3000;

// Group that holds all free Z-axis nodes (anchored at scene origin).
const freeNodesGroup = new THREE.Group();
freeNodesGroup.userData = { type: 'freeNodesGroup' };
scene.add(freeNodesGroup);

// Z-axis indicator — a faint vertical reference line through origin.
(function buildZAxisIndicator() {
    const yMax = 4 * PLANE_GAP;
    const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -yMax, 0),
        new THREE.Vector3(0,  yMax, 0)
    ]);
    const mat = new THREE.LineDashedMaterial({
        color: 0xe8ffe8, transparent: true, opacity: 0.18,
        dashSize: 14, gapSize: 18
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    line.userData = { type: 'zAxis' };
    scene.add(line);
})();

// Maps id -> three objects
const planeGroups = new Map();   // planeId -> THREE.Group
const planeMeshes = new Map();   // planeId -> click target Mesh
const nodeRecords = new Map();   // nodeId  -> { mesh, sprite }
const edgeRecords = new Map();   // edgeId  -> { line, sprite }

// Connect-mode guide line (pending node -> cursor).
let guideLine = null;
let cursorWorld = new THREE.Vector3();

// ---------- text-sprite ----------
function makeTextSprite(text, color, size, opts) {
    size = size || 56;
    opts = opts || {};
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = '600 ' + size + 'px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    if (opts.bg) {
        const metrics = ctx.measureText(text);
        const padX = 14, padY = 12;
        const w = Math.min(canvas.width, metrics.width + padX * 2);
        const h = size + padY * 2;
        ctx.fillStyle = opts.bg;
        ctx.fillRect(0, canvas.height/2 - h/2, w, h);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(1, canvas.height/2 - h/2 + 1, w - 2, h - 2);
    } else {
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 10;
    }

    ctx.fillStyle = color;
    ctx.fillText(text, opts.bg ? 14 : 6, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 5;
    return sprite;
}

// ---------- plane builders ----------
function buildPlane(p) {
    const group = new THREE.Group();
    group.position.y = p.y;
    group.userData = { type: 'planeGroup', planeId: p.id };

    const fillGeom = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
    fillGeom.rotateX(-Math.PI / 2);
    const fillMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(p.color),
        transparent: true,
        opacity: 0.035,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const fill = new THREE.Mesh(fillGeom, fillMat);
    fill.userData = { type: 'plane', planeId: p.id };
    group.add(fill);
    planeMeshes.set(p.id, fill);

    const frameGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-PLANE_W/2, 0, -PLANE_H/2),
        new THREE.Vector3( PLANE_W/2, 0, -PLANE_H/2),
        new THREE.Vector3( PLANE_W/2, 0,  PLANE_H/2),
        new THREE.Vector3(-PLANE_W/2, 0,  PLANE_H/2),
        new THREE.Vector3(-PLANE_W/2, 0, -PLANE_H/2)
    ]);
    const frame = new THREE.Line(frameGeom, new THREE.LineBasicMaterial({
        color: new THREE.Color(p.color),
        transparent: true,
        opacity: 0.32
    }));
    group.add(frame);

    const grid = new THREE.GridHelper(PLANE_W, 12, p.color, p.color);
    grid.material.transparent = true;
    grid.material.opacity = 0.07;
    group.add(grid);

    const holo = holoForPlane(p);
    if (holo) group.add(holo);

    const label = makeTextSprite(p.label, p.color, 60);
    label.position.set(-PLANE_W/2 - 30, 14, -PLANE_H/2 + 10);
    label.scale.set(220, 42, 1);
    group.add(label);

    scene.add(group);
    planeGroups.set(p.id, group);
}

function disposePlane(planeId) {
    const g = planeGroups.get(planeId);
    if (!g) return;
    g.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
        }
    });
    scene.remove(g);
    planeGroups.delete(planeId);
    planeMeshes.delete(planeId);
}

function buildPlanes() {
    Array.from(planeGroups.keys()).forEach(disposePlane);
    state.planes.forEach(buildPlane);
}

// ---------- node builders ----------
function nodeParentGroup(n) {
    if (isFreeNode(n)) return freeNodesGroup;
    return planeGroups.get(n.planeId) || null;
}

function addNodeMesh(n) {
    const parent = nodeParentGroup(n);
    if (!parent) return;
    const free = isFreeNode(n);
    const color = nodeColor(n);

    const geom = free
        ? new THREE.OctahedronGeometry(FREE_NODE_R, 0)
        : new THREE.SphereGeometry(NODE_R, 18, 18);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
    const mesh = new THREE.Mesh(geom, mat);
    if (free) {
        mesh.position.set(n.x, nodeAbsoluteY(n), n.z);
        mesh.rotation.y = Math.PI / 4;
    } else {
        mesh.position.set(n.x, 2, n.z);
    }
    mesh.userData = { type: 'node', nodeId: n.id };
    mesh.renderOrder = 3;
    parent.add(mesh);

    const sprite = makeTextSprite(n.title || 'untitled', '#e8ffe8', 44);
    if (free) {
        sprite.position.set(n.x, nodeAbsoluteY(n) + 18, n.z);
    } else {
        sprite.position.set(n.x, 18, n.z);
    }
    sprite.scale.set(120, 22, 1);
    parent.add(sprite);

    nodeRecords.set(n.id, { mesh, sprite });
}

function disposeNode(nodeId) {
    const rec = nodeRecords.get(nodeId);
    if (!rec) return;
    [rec.mesh, rec.sprite].forEach(o => {
        if (o.parent) o.parent.remove(o);
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
        }
    });
    nodeRecords.delete(nodeId);
}

function buildNodes() {
    Array.from(nodeRecords.keys()).forEach(disposeNode);
    state.nodes.forEach(addNodeMesh);
}

function setNodeMeshPosition(n) {
    const rec = nodeRecords.get(n.id);
    if (!rec) return;
    const y = isFreeNode(n) ? nodeAbsoluteY(n) : 2;
    rec.mesh.position.set(n.x, y, n.z);
    rec.sprite.position.set(n.x, y + (isFreeNode(n) ? 18 : 16), n.z);
}

// ---------- edge builders ----------
function edgeMidpoint(e) {
    const a = state.nodes.find(n => n.id === e.fromId);
    const b = state.nodes.find(n => n.id === e.toId);
    if (!a || !b) return new THREE.Vector3();
    const ay = nodeAbsoluteY(a) + 2;
    const by = nodeAbsoluteY(b) + 2;
    return new THREE.Vector3(
        (a.x + b.x) / 2,
        (ay + by) / 2 + 8,
        (a.z + b.z) / 2
    );
}

function isCrossPlaneEdge(e) {
    const a = state.nodes.find(n => n.id === e.fromId);
    const b = state.nodes.find(n => n.id === e.toId);
    if (!a || !b) return false;
    return nodeAbsoluteY(a) !== nodeAbsoluteY(b) || a.planeId !== b.planeId;
}

function makeEdgeLabelSprite(label, isCross) {
    const text = (label && label.trim()) ? label : '+';
    const color = isCross ? '#e8ffe8' : '#0a1a10';
    const bg = isCross ? 'rgba(8,4,0,0.85)' : 'rgba(255,153,51,0.92)';
    const sprite = makeTextSprite(text, color, 38, { bg: bg });
    sprite.scale.set(110, 28, 1);
    sprite.material.opacity = (label && label.trim()) ? 1 : 0.55;
    return sprite;
}

function addEdgeLine(e) {
    const a = state.nodes.find(n => n.id === e.fromId);
    const b = state.nodes.find(n => n.id === e.toId);
    if (!a || !b) return;
    const isCross = isCrossPlaneEdge(e);
    const ap = nodeAbsoluteY(a);
    const bp = nodeAbsoluteY(b);
    const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, ap + 2, a.z),
        new THREE.Vector3(b.x, bp + 2, b.z)
    ]);
    const mat = isCross
        ? new THREE.LineDashedMaterial({
            color: 0xffffff, transparent: true, opacity: 0.78,
            dashSize: 12, gapSize: 8
        })
        : new THREE.LineBasicMaterial({
            color: new THREE.Color(nodeColor(a)), transparent: true, opacity: 0.6
        });
    const line = new THREE.Line(geom, mat);
    if (isCross) line.computeLineDistances();
    line.userData = { type: 'edge', edgeId: e.id };
    line.renderOrder = 2;
    scene.add(line);

    const sprite = makeEdgeLabelSprite(e.label || '', isCross);
    sprite.position.copy(edgeMidpoint(e));
    sprite.userData = { type: 'edge', edgeId: e.id };
    scene.add(sprite);

    edgeRecords.set(e.id, { line, sprite });
}

function disposeEdge(edgeId) {
    const rec = edgeRecords.get(edgeId);
    if (!rec) return;
    [rec.line, rec.sprite].forEach(o => {
        if (o.parent) o.parent.remove(o);
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
        }
    });
    edgeRecords.delete(edgeId);
}

function buildEdges() {
    Array.from(edgeRecords.keys()).forEach(disposeEdge);
    state.edges.forEach(addEdgeLine);
}

function updateEdgeGeometry(e) {
    const rec = edgeRecords.get(e.id);
    if (!rec) return;
    const a = state.nodes.find(n => n.id === e.fromId);
    const b = state.nodes.find(n => n.id === e.toId);
    if (!a || !b) return;
    const ay = nodeAbsoluteY(a) + 2;
    const by = nodeAbsoluteY(b) + 2;
    rec.line.geometry.setFromPoints([
        new THREE.Vector3(a.x, ay, a.z),
        new THREE.Vector3(b.x, by, b.z)
    ]);
    if (rec.line.material.isLineDashedMaterial) rec.line.computeLineDistances();
    rec.sprite.position.copy(edgeMidpoint(e));
}

function refreshEdgeLabel(e) {
    const rec = edgeRecords.get(e.id);
    if (!rec) return;
    const isCross = isCrossPlaneEdge(e);
    const newSprite = makeEdgeLabelSprite(e.label || '', isCross);
    newSprite.position.copy(rec.sprite.position);
    newSprite.userData = rec.sprite.userData;
    scene.add(newSprite);
    scene.remove(rec.sprite);
    if (rec.sprite.material.map) rec.sprite.material.map.dispose();
    rec.sprite.material.dispose();
    rec.sprite = newSprite;
}

function rebuild() {
    buildPlanes();
    buildNodes();
    buildEdges();
    refreshPlanesPanel();
    refreshSelectionVisuals();
}

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 8 };
raycaster.params.Points = { threshold: 6 };
const ndc = new THREE.Vector2();

function setNDC(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

function pickAt(clientX, clientY) {
    setNDC(clientX, clientY);
    raycaster.setFromCamera(ndc, camera);

    // Nodes first.
    const nodeMeshes = [];
    nodeRecords.forEach(r => nodeMeshes.push(r.mesh));
    let hits = raycaster.intersectObjects(nodeMeshes, false);
    if (hits.length) {
        return { type: 'node', nodeId: hits[0].object.userData.nodeId, point: hits[0].point };
    }

    // Edge label sprites.
    const edgeSprites = [];
    edgeRecords.forEach(r => edgeSprites.push(r.sprite));
    hits = raycaster.intersectObjects(edgeSprites, false);
    if (hits.length) {
        return { type: 'edge', edgeId: hits[0].object.userData.edgeId, point: hits[0].point };
    }

    // Edge lines.
    const edgeLines = [];
    edgeRecords.forEach(r => edgeLines.push(r.line));
    hits = raycaster.intersectObjects(edgeLines, false);
    if (hits.length) {
        return { type: 'edge', edgeId: hits[0].object.userData.edgeId, point: hits[0].point };
    }

    // Planes last (large click area).
    const planes = [];
    planeMeshes.forEach(m => planes.push(m));
    hits = raycaster.intersectObjects(planes, false);
    if (hits.length) {
        return { type: 'plane', planeId: hits[0].object.userData.planeId, point: hits[0].point };
    }
    return null;
}

function intersectPlaneY(planeY) {
    const ray = raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (planeY - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    return new THREE.Vector3(
        ray.origin.x + ray.direction.x * t,
        planeY,
        ray.origin.z + ray.direction.z * t
    );
}

// ---------- interactions ----------
let dragging = null;
let downX = 0, downY = 0;

renderer.domElement.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    const pick = pickAt(e.clientX, e.clientY);
    if (pick && pick.type === 'node' && !connectMode) {
        dragging = { type: 'node', nodeId: pick.nodeId, moved: false };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
    }
});

renderer.domElement.addEventListener('pointermove', e => {
    // Track cursor in world for connect-mode guide line.
    setNDC(e.clientX, e.clientY);
    raycaster.setFromCamera(ndc, camera);

    if (connectMode && pendingFromId) {
        const p = state.nodes.find(n => n.id === pendingFromId);
        if (p) {
            const proj = intersectPlaneY(nodeAbsoluteY(p));
            if (proj) cursorWorld.copy(proj);
        }
    }

    if (!dragging) return;
    if (dragging.type !== 'node') return;
    const node = state.nodes.find(n => n.id === dragging.nodeId);
    if (!node) return;
    const targetY = nodeAbsoluteY(node);
    const point = intersectPlaneY(targetY);
    if (!point) return;
    node.x = point.x;
    node.z = point.z;
    setNodeMeshPosition(node);
    state.edges.forEach(eg => {
        if (eg.fromId === node.id || eg.toId === node.id) updateEdgeGeometry(eg);
    });
    dragging.moved = true;
});

renderer.domElement.addEventListener('pointerup', e => {
    const wasDrag = (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY)) > 4;
    if (dragging) {
        if (dragging.moved) save();
        const wasNodeDrag = dragging;
        dragging = null;
        controls.enabled = true;
        try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (_) {}
        if (wasNodeDrag.moved) return;
    }
    if (wasDrag) return;

    const pick = pickAt(e.clientX, e.clientY);
    if (!pick) {
        if (connectMode && pendingFromId) {
            pendingFromId = null;
            refreshSelectionVisuals();
            updateBanner();
            updateGuideLine();
        } else {
            selectNode(null);
        }
        return;
    }

    if (pick.type === 'node') {
        if (connectMode) {
            handleConnectClick(pick.nodeId);
        } else {
            selectNode(pick.nodeId);
        }
        return;
    }

    if (pick.type === 'edge') {
        if (connectMode) {
            // Stay in connect mode; cancel pending if any.
            if (pendingFromId) {
                pendingFromId = null;
                refreshSelectionVisuals();
                updateBanner();
                updateGuideLine();
            }
            return;
        }
        if (e.shiftKey) {
            const edge = state.edges.find(x => x.id === pick.edgeId);
            if (!edge) return;
            if (window.confirm('Delete this connection?')) {
                state.edges = state.edges.filter(x => x.id !== edge.id);
                disposeEdge(edge.id);
                save();
                if (selectedId) {
                    const sel = state.nodes.find(x => x.id === selectedId);
                    if (sel) renderEdgesPanel(sel);
                }
            }
        } else {
            editEdgeLabel(pick.edgeId);
        }
        return;
    }

    if (pick.type === 'plane') {
        if (connectMode) {
            if (pendingFromId) {
                pendingFromId = null;
                refreshSelectionVisuals();
                updateBanner();
                updateGuideLine();
            }
            return;
        }
        const title = window.prompt('Title for this node:');
        if (title === null) return;
        const trimmed = title.trim() || 'untitled';
        const node = {
            id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            planeId: pick.planeId,
            x: pick.point.x,
            z: pick.point.z,
            title: trimmed,
            description: '',
            links: []
        };
        state.nodes.push(node);
        addNodeMesh(node);
        save();
    }
});

// ---------- edge label edit ----------
function editEdgeLabel(edgeId) {
    const edge = state.edges.find(e => e.id === edgeId);
    if (!edge) return;
    const next = window.prompt(
        'Connection label (the type of relation, ≈ Obsidian Canvas note on the string):',
        edge.label || ''
    );
    if (next === null) return;
    edge.label = next.trim();
    refreshEdgeLabel(edge);
    save();
    if (selectedId) {
        const sel = state.nodes.find(x => x.id === selectedId);
        if (sel) renderEdgesPanel(sel);
    }
}

// ---------- connect mode ----------
const banner = document.getElementById('banner');

function toggleConnectMode() {
    connectMode = !connectMode;
    document.getElementById('btn-connect').classList.toggle('on', connectMode);
    pendingFromId = null;
    refreshSelectionVisuals();
    updateBanner();
    updateGuideLine();
}

function handleConnectClick(nodeId) {
    if (!pendingFromId) {
        pendingFromId = nodeId;
        refreshSelectionVisuals();
        updateBanner();
        updateGuideLine();
        return;
    }
    if (pendingFromId === nodeId) {
        pendingFromId = null;
        refreshSelectionVisuals();
        updateBanner();
        updateGuideLine();
        return;
    }
    const exists = state.edges.find(e =>
        (e.fromId === pendingFromId && e.toId === nodeId) ||
        (e.fromId === nodeId && e.toId === pendingFromId)
    );
    if (!exists) {
        const label = window.prompt('Label for this connection (the relation type — leave blank to skip):', '') || '';
        const edge = {
            id: 'e_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            fromId: pendingFromId,
            toId: nodeId,
            label: label.trim()
        };
        state.edges.push(edge);
        addEdgeLine(edge);
        save();
    }
    pendingFromId = null;
    refreshSelectionVisuals();
    updateBanner();
    updateGuideLine();
    if (selectedId) {
        const sel = state.nodes.find(x => x.id === selectedId);
        if (sel) renderEdgesPanel(sel);
    }
}

function updateBanner() {
    if (!connectMode) {
        banner.classList.add('hidden');
        return;
    }
    banner.classList.remove('hidden');
    banner.textContent = pendingFromId
        ? 'Pick the second node — same plane, another plane, or a Z-node'
        : 'Connect ⌁ — click any two nodes; cross-plane connections render as dashed white lines';
}

function updateGuideLine() {
    if (guideLine) {
        scene.remove(guideLine);
        if (guideLine.geometry) guideLine.geometry.dispose();
        if (guideLine.material) guideLine.material.dispose();
        guideLine = null;
    }
    if (!connectMode || !pendingFromId) return;
    const from = state.nodes.find(n => n.id === pendingFromId);
    if (!from) return;
    const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(from.x, nodeAbsoluteY(from) + 2, from.z),
        cursorWorld.clone()
    ]);
    const mat = new THREE.LineDashedMaterial({
        color: 0xffffff, transparent: true, opacity: 0.5,
        dashSize: 10, gapSize: 6
    });
    guideLine = new THREE.Line(geom, mat);
    guideLine.computeLineDistances();
    scene.add(guideLine);
}

function refreshSelectionVisuals() {
    nodeRecords.forEach((rec, id) => {
        const node = state.nodes.find(n => n.id === id);
        if (!node) return;
        const baseColor = nodeColor(node);
        if (id === pendingFromId) {
            rec.mesh.scale.set(1.7, 1.7, 1.7);
            rec.mesh.material.color.set(0xffffff);
        } else if (id === selectedId) {
            rec.mesh.scale.set(1.5, 1.5, 1.5);
            rec.mesh.material.color.set(new THREE.Color(baseColor));
        } else {
            rec.mesh.scale.set(1, 1, 1);
            rec.mesh.material.color.set(new THREE.Color(baseColor));
        }
    });
}

// ---------- selection / panel ----------
const panel = document.getElementById('notes-panel');
const npTitle = document.getElementById('np-title');
const npDesc = document.getElementById('np-description');
const npPlane = document.getElementById('np-plane');
const npYRow = document.getElementById('np-y-row');
const npY = document.getElementById('np-y');
const npSource = document.getElementById('np-source');
const npLinks = document.getElementById('np-links');
const npEdges = document.getElementById('np-edges');

const FREE_OPTION = '__free__';

function selectNode(id) {
    selectedId = id;
    refreshSelectionVisuals();
    if (id) showPanel(id);
    else hidePanel();
}

function showPanel(id) {
    const n = state.nodes.find(x => x.id === id);
    if (!n) { hidePanel(); return; }
    panel.classList.remove('hidden');
    npTitle.value = n.title || '';
    npDesc.value = n.description || '';
    populatePlaneSelect(n);
    syncYRow(n);
    renderSource(n);
    renderEdgesPanel(n);
    renderLinks(n);
}

function hidePanel() {
    panel.classList.add('hidden');
}

function populatePlaneSelect(n) {
    npPlane.innerHTML = '';
    state.planes.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label;
        if (!isFreeNode(n) && p.id === n.planeId) opt.selected = true;
        npPlane.appendChild(opt);
    });
    const free = document.createElement('option');
    free.value = FREE_OPTION;
    free.textContent = '◇  FREE · Z-AXIS';
    if (isFreeNode(n)) free.selected = true;
    npPlane.appendChild(free);
}

function syncYRow(n) {
    if (isFreeNode(n)) {
        npYRow.classList.remove('hidden');
        npY.value = Math.round(n.y || 0);
    } else {
        npYRow.classList.add('hidden');
    }
}

function renderSource(n) {
    npSource.innerHTML = '';
    if (n.sourceLayer && n.sourceNodeId) {
        const a = document.createElement('a');
        a.href = 'layer.html?layer=' + n.sourceLayer;
        a.className = 'np-source-link';
        a.textContent = 'Open ' + n.sourceLayer.toUpperCase() + ' (2D)';
        npSource.appendChild(a);
    } else {
        npSource.textContent = '— unlinked —';
    }
}

function renderEdgesPanel(n) {
    npEdges.innerHTML = '';
    const incident = state.edges.filter(e => e.fromId === n.id || e.toId === n.id);
    if (!incident.length) {
        const empty = document.createElement('div');
        empty.className = 'np-edges-empty';
        empty.textContent = 'No connections yet — toggle Connect ⌁ to link nodes.';
        npEdges.appendChild(empty);
        return;
    }
    incident.forEach(e => {
        const otherId = e.fromId === n.id ? e.toId : e.fromId;
        const other = state.nodes.find(x => x.id === otherId);
        if (!other) return;
        const otherPlane = state.planes.find(p => p.id === other.planeId);
        const row = document.createElement('div');
        row.className = 'np-edge-row';

        const target = document.createElement('span');
        target.className = 'np-edge-target';
        target.textContent = other.title || 'untitled';
        target.title = 'Jump to node';
        target.style.cursor = 'pointer';
        target.addEventListener('click', () => selectNode(other.id));

        const planeTag = document.createElement('span');
        planeTag.className = 'np-edge-plane';
        if (isFreeNode(other)) {
            planeTag.textContent = 'Z-AXIS';
            planeTag.style.color = FREE_NODE_COLOR;
        } else if (otherPlane) {
            planeTag.textContent = otherPlane.label;
            planeTag.style.color = otherPlane.color;
        }

        const labelBtn = document.createElement('button');
        labelBtn.className = 'np-edge-label-btn';
        labelBtn.textContent = e.label ? '“' + e.label + '”' : '+ label';
        labelBtn.title = 'Edit connection label';
        labelBtn.addEventListener('click', () => editEdgeLabel(e.id));

        const rm = document.createElement('button');
        rm.className = 'np-edge-remove';
        rm.textContent = '×';
        rm.title = 'Remove connection';
        rm.addEventListener('click', () => {
            state.edges = state.edges.filter(x => x.id !== e.id);
            disposeEdge(e.id);
            save();
            renderEdgesPanel(n);
        });

        row.appendChild(target);
        row.appendChild(planeTag);
        row.appendChild(labelBtn);
        row.appendChild(rm);
        npEdges.appendChild(row);
    });
}

function renderLinks(n) {
    npLinks.innerHTML = '';
    const links = n.links || [];
    links.forEach((link, idx) => {
        const row = document.createElement('div');
        row.className = 'np-link-row';

        const labelInput = document.createElement('input');
        labelInput.className = 'np-link-label';
        labelInput.placeholder = 'Label';
        labelInput.value = link.label || '';
        labelInput.addEventListener('blur', () => { link.label = labelInput.value; save(); });

        const urlInput = document.createElement('input');
        urlInput.className = 'np-link-url';
        urlInput.placeholder = 'https://…';
        urlInput.value = link.url || '';
        urlInput.addEventListener('blur', () => { link.url = urlInput.value; save(); });

        const rm = document.createElement('button');
        rm.className = 'np-link-remove';
        rm.textContent = '×';
        rm.addEventListener('click', () => {
            n.links.splice(idx, 1);
            save();
            renderLinks(n);
        });

        row.appendChild(labelInput);
        row.appendChild(urlInput);
        row.appendChild(rm);
        npLinks.appendChild(row);
    });
}

function updateNodeLabelSprite(n) {
    const rec = nodeRecords.get(n.id);
    if (!rec) return;
    const newSprite = makeTextSprite(n.title || 'untitled', '#e8ffe8', 44);
    newSprite.position.copy(rec.sprite.position);
    newSprite.scale.copy(rec.sprite.scale);
    const parent = rec.sprite.parent;
    parent.add(newSprite);
    parent.remove(rec.sprite);
    if (rec.sprite.material.map) rec.sprite.material.map.dispose();
    rec.sprite.material.dispose();
    rec.sprite = newSprite;
}

let titleTimer = null;
npTitle.addEventListener('input', () => {
    if (!selectedId) return;
    const n = state.nodes.find(x => x.id === selectedId);
    if (!n) return;
    n.title = npTitle.value;
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => updateNodeLabelSprite(n), 250);
});
npTitle.addEventListener('blur', () => {
    clearTimeout(titleTimer);
    if (selectedId) {
        const n = state.nodes.find(x => x.id === selectedId);
        if (n) updateNodeLabelSprite(n);
    }
    save();
});

let descTimer = null;
npDesc.addEventListener('input', () => {
    if (!selectedId) return;
    const n = state.nodes.find(x => x.id === selectedId);
    if (!n) return;
    n.description = npDesc.value;
    clearTimeout(descTimer);
    descTimer = setTimeout(save, 400);
});
npDesc.addEventListener('blur', () => { clearTimeout(descTimer); save(); });

npPlane.addEventListener('change', () => {
    if (!selectedId) return;
    const n = state.nodes.find(x => x.id === selectedId);
    if (!n) return;
    const v = npPlane.value;
    const wasFree = isFreeNode(n);

    if (v === FREE_OPTION) {
        if (wasFree) return;
        const oldPlane = state.planes.find(p => p.id === n.planeId);
        n.y = oldPlane ? oldPlane.y : 0;
        n.planeId = null;
    } else {
        if (!wasFree && v === n.planeId) return;
        n.planeId = v;
        delete n.y;
    }

    // Rebuild this node mesh (geometry differs between sphere ↔ octahedron).
    disposeNode(n.id);
    addNodeMesh(n);
    state.edges.forEach(e => {
        if (e.fromId === n.id || e.toId === n.id) updateEdgeGeometry(e);
    });
    syncYRow(n);
    refreshSelectionVisuals();
    save();
});

npY.addEventListener('input', () => {
    if (!selectedId) return;
    const n = state.nodes.find(x => x.id === selectedId);
    if (!n || !isFreeNode(n)) return;
    const v = parseFloat(npY.value);
    if (isNaN(v)) return;
    n.y = v;
    setNodeMeshPosition(n);
    state.edges.forEach(e => {
        if (e.fromId === n.id || e.toId === n.id) updateEdgeGeometry(e);
    });
});
npY.addEventListener('blur', save);

document.getElementById('btn-add-link').addEventListener('click', () => {
    if (!selectedId) return;
    const n = state.nodes.find(x => x.id === selectedId);
    if (!n) return;
    if (!n.links) n.links = [];
    n.links.push({ label: '', url: '' });
    renderLinks(n);
});

document.getElementById('btn-np-close').addEventListener('click', () => selectNode(null));

document.getElementById('btn-np-delete').addEventListener('click', () => {
    if (!selectedId) return;
    if (!window.confirm('Delete this node?')) return;
    deleteNode(selectedId);
});

function deleteNode(id) {
    state.edges = state.edges.filter(e => {
        if (e.fromId === id || e.toId === id) {
            disposeEdge(e.id);
            return false;
        }
        return true;
    });
    state.nodes = state.nodes.filter(n => n.id !== id);
    disposeNode(id);
    if (selectedId === id) { selectedId = null; hidePanel(); }
    if (pendingFromId === id) { pendingFromId = null; updateBanner(); updateGuideLine(); }
    save();
}

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteNode(selectedId);
    } else if (e.key === 'Escape') {
        if (connectMode) toggleConnectMode();
        else selectNode(null);
    } else if (e.key.toLowerCase() === 'c') {
        toggleConnectMode();
    }
});

// ---------- toolbar ----------
document.getElementById('btn-connect').addEventListener('click', toggleConnectMode);

document.getElementById('btn-focus').addEventListener('click', () => {
    let plane = null;
    if (selectedId) {
        const n = state.nodes.find(x => x.id === selectedId);
        plane = n && state.planes.find(p => p.id === n.planeId);
    }
    if (!plane) plane = state.planes[0];
    if (!plane) return;
    controls.target.set(0, plane.y, 0);
    camera.position.set(0.01, plane.y + 720, 0.01);
    controls.update();
});

document.getElementById('btn-orbit').addEventListener('click', () => {
    controls.target.set(0, 0, 0);
    camera.position.set(820, 580, 1080);
    controls.update();
});

const helpCard = document.getElementById('help-card');
document.getElementById('btn-help').addEventListener('click', () => {
    helpCard.classList.toggle('hidden');
});

document.getElementById('btn-add-plane').addEventListener('click', () => {
    const label = window.prompt('Plane name:');
    if (label === null) return;
    const trimmed = label.trim() || 'PLANE';
    const minY = state.planes.reduce((m, p) => Math.min(m, p.y), 0);
    const id = 'plane_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const color = PLANE_PALETTE[state.planes.length % PLANE_PALETTE.length];
    state.planes.push({
        id,
        label: trimmed.toUpperCase(),
        y: minY - PLANE_GAP,
        color,
        linkedLayer: null
    });
    save();
    rebuild();
});

document.getElementById('btn-add-znode').addEventListener('click', () => {
    const title = window.prompt('Title for the new Z-node (free, between planes):');
    if (title === null) return;
    const trimmed = title.trim() || 'untitled';
    // Drop it midway between the highest and lowest plane.
    let yMid = 0;
    if (state.planes.length) {
        const ys = state.planes.map(p => p.y);
        yMid = (Math.max(...ys) + Math.min(...ys)) / 2;
    }
    // Offset slightly so multiple z-nodes don't stack.
    const jitter = (state.nodes.filter(isFreeNode).length % 5) * 30;
    const node = {
        id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        planeId: null,
        x: jitter,
        y: yMid + jitter,
        z: jitter,
        title: trimmed,
        description: '',
        links: []
    };
    state.nodes.push(node);
    addNodeMesh(node);
    save();
    selectNode(node.id);
});

document.getElementById('btn-import').addEventListener('click', () => {
    const linked = state.planes.filter(p => p.linkedLayer);
    if (!linked.length) {
        alert('No planes are linked to a 2D stratum.');
        return;
    }
    const list = linked.map((p, i) => (i + 1) + '. ' + p.label + '  ←  ' + p.linkedLayer).join('\n');
    const choice = window.prompt(
        'Pull which stratum onto its plane?\n\n' + list + '\n\nEnter number:',
        '1'
    );
    if (choice === null) return;
    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= linked.length) return;
    importLayerInto(linked[idx]);
});

function importLayerInto(plane) {
    const raw = localStorage.getItem('sv-strata.layer.' + plane.linkedLayer);
    if (!raw) {
        alert('No saved data for ' + plane.linkedLayer + ' yet.');
        return;
    }
    let data;
    try { data = JSON.parse(raw); }
    catch (err) { alert('Could not parse stratum data.'); return; }

    const sourceNodes = data.nodes || [];
    const sourceEdges = data.edges || [];
    if (!sourceNodes.length) {
        alert('That stratum has no nodes.');
        return;
    }

    const idMap = {};
    state.nodes.forEach(n => {
        if (n.sourceLayer === plane.linkedLayer && n.sourceNodeId) {
            idMap[n.sourceNodeId] = n.id;
        }
    });

    let added = 0, updated = 0;
    sourceNodes.forEach(sn => {
        const x = sn.x - 270;
        const z = sn.y - 270;
        if (idMap[sn.id]) {
            const existing = state.nodes.find(n => n.id === idMap[sn.id]);
            if (!existing) return;
            existing.title = sn.title || existing.title;
            existing.description = sn.description !== undefined ? sn.description : existing.description;
            existing.links = sn.links || existing.links;
            existing.x = x;
            existing.z = z;
            existing.planeId = plane.id;
            delete existing.y;
            updated++;
        } else {
            const newId = 'n_' + Date.now() + '_' + Math.floor(Math.random() * 100000) + '_' + sn.id;
            state.nodes.push({
                id: newId,
                planeId: plane.id,
                x, z,
                title: sn.title || 'untitled',
                description: sn.description || '',
                links: sn.links || [],
                sourceLayer: plane.linkedLayer,
                sourceNodeId: sn.id
            });
            idMap[sn.id] = newId;
            added++;
        }
    });

    sourceEdges.forEach(se => {
        const fromId = idMap[se.fromId];
        const toId = idMap[se.toId];
        if (!fromId || !toId) return;
        const exists = state.edges.find(e =>
            (e.fromId === fromId && e.toId === toId) ||
            (e.fromId === toId && e.toId === fromId)
        );
        if (exists) return;
        state.edges.push({
            id: 'e_' + Date.now() + '_' + Math.floor(Math.random() * 100000) + '_' + se.id,
            fromId, toId,
            label: se.label || ''
        });
    });

    save();
    rebuild();
    banner.textContent = 'Imported ' + plane.label + ': ' + added + ' new · ' + updated + ' synced';
    banner.classList.remove('hidden');
    setTimeout(() => { if (!connectMode) banner.classList.add('hidden'); }, 2400);
}

// ---------- planes panel (left) ----------
const planesList = document.getElementById('planes-list');

function refreshPlanesPanel() {
    planesList.innerHTML = '';
    state.planes.forEach(p => {
        const row = document.createElement('div');
        row.className = 'pp-row';

        const dot = document.createElement('span');
        dot.className = 'pp-dot';
        dot.style.background = p.color;
        dot.style.color = p.color;

        const label = document.createElement('span');
        label.className = 'pp-label';
        label.textContent = p.label;
        label.title = p.linkedLayer ? 'Linked to 2D ' + p.linkedLayer : 'Standalone plane';

        const yInput = document.createElement('input');
        yInput.className = 'pp-y';
        yInput.type = 'number';
        yInput.value = Math.round(p.y);
        yInput.step = 50;
        yInput.addEventListener('change', () => {
            const v = parseFloat(yInput.value);
            if (isNaN(v)) return;
            p.y = v;
            const g = planeGroups.get(p.id);
            if (g) g.position.y = v;
            state.edges.forEach(eg => {
                const a = state.nodes.find(n => n.id === eg.fromId);
                const b = state.nodes.find(n => n.id === eg.toId);
                if (a && b && (a.planeId === p.id || b.planeId === p.id)) updateEdgeGeometry(eg);
            });
            save();
        });

        row.appendChild(dot);
        row.appendChild(label);
        row.appendChild(yInput);

        if (!p.linkedLayer) {
            const rm = document.createElement('button');
            rm.className = 'pp-remove';
            rm.textContent = '×';
            rm.title = 'Remove plane (and all its nodes)';
            rm.addEventListener('click', () => {
                if (!window.confirm('Remove plane "' + p.label + '" and all its nodes?')) return;
                const removedNodeIds = state.nodes.filter(n => n.planeId === p.id).map(n => n.id);
                state.edges = state.edges.filter(e => {
                    if (removedNodeIds.includes(e.fromId) || removedNodeIds.includes(e.toId)) {
                        disposeEdge(e.id);
                        return false;
                    }
                    return true;
                });
                removedNodeIds.forEach(disposeNode);
                state.nodes = state.nodes.filter(n => n.planeId !== p.id);
                state.planes = state.planes.filter(x => x.id !== p.id);
                disposePlane(p.id);
                if (selectedId && removedNodeIds.includes(selectedId)) {
                    selectedId = null;
                    hidePanel();
                }
                save();
                refreshPlanesPanel();
            });
            row.appendChild(rm);
        }

        planesList.appendChild(row);
    });

    // Free-node summary row.
    const freeCount = state.nodes.filter(isFreeNode).length;
    const zRow = document.createElement('div');
    zRow.className = 'pp-row pp-row-z';
    const zDot = document.createElement('span');
    zDot.className = 'pp-dot';
    zDot.style.background = FREE_NODE_COLOR;
    zDot.style.color = FREE_NODE_COLOR;
    const zLabel = document.createElement('span');
    zLabel.className = 'pp-label';
    zLabel.textContent = 'Z-AXIS  ·  ' + freeCount;
    zLabel.title = 'Free nodes between planes';
    zRow.appendChild(zDot);
    zRow.appendChild(zLabel);
    planesList.appendChild(zRow);
}

// ---------- resize ----------
window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});

// ---------- loop ----------
function tick() {
    controls.update();
    if (connectMode && pendingFromId) updateGuideLine();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
}

// ---------- init ----------
rebuild();
tick();

})();
