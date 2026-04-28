(function () {
    'use strict';

    // --- Resolve which layer this page is editing ---
    var params = new URLSearchParams(window.location.search);
    var layerId = params.get('layer') || 'faces';
    var layerMeta = window.SV_LAYERS.find(function (l) { return l.id === layerId; });
    if (!layerMeta) { layerMeta = window.SV_LAYERS[0]; layerId = layerMeta.id; }

    document.body.classList.add('layer-' + layerId);
    document.title = 'SV STRATA — ' + layerMeta.title;
    document.getElementById('breadcrumb').textContent = layerMeta.title;

    // --- DOM refs ---
    var svg = document.getElementById('canvas');
    var viewport = document.getElementById('viewport');
    var nodesLayer = document.getElementById('nodes-layer');
    var bgPath = document.getElementById('sv-shape-bg');
    bgPath.setAttribute('d', window.SV_PATH);

    // --- State ---
    var STORAGE_KEY = 'sv-strata.layer.' + layerId;
    var state = loadState();
    var view = state.view;
    var nodes = state.nodes;
    var edges = state.edges;

    var selectedId = null;
    var dragging = null; // { type, ... }
    var didDrag = false;
    var DRAG_THRESHOLD = 4;
    var SVG_NS = 'http://www.w3.org/2000/svg';

    function loadState() {
        var raw = localStorage.getItem(STORAGE_KEY);
        var def = { view: { x: 0, y: 0, scale: 1 }, nodes: [], edges: [] };
        if (!raw) return def;
        try {
            var s = JSON.parse(raw);
            return {
                view: s.view || def.view,
                nodes: Array.isArray(s.nodes) ? s.nodes : [],
                edges: Array.isArray(s.edges) ? s.edges : []
            };
        } catch (e) {
            return def;
        }
    }

    function save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            view: view, nodes: nodes, edges: edges
        }));
    }

    // --- Coordinate helpers ---
    function svgPoint(clientX, clientY) {
        var pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
    }
    function clientToWorld(clientX, clientY) {
        var p = svgPoint(clientX, clientY);
        return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
    }

    function applyView() {
        viewport.setAttribute('transform',
            'translate(' + view.x + ',' + view.y + ') scale(' + view.scale + ')');
    }

    function fitToContour() {
        // Center the SV outline (~270, 270) in the viewport.
        var rect = svg.getBoundingClientRect();
        view.scale = Math.min(rect.width / 600, rect.height / 600) || 1;
        view.scale = Math.min(view.scale, 1.4);
        view.x = rect.width / 2 - 270 * view.scale;
        view.y = rect.height / 2 - 270 * view.scale;
        applyView();
        save();
    }

    // --- Rendering ---
    function renderAll() {
        while (nodesLayer.firstChild) nodesLayer.removeChild(nodesLayer.firstChild);
        nodes.forEach(renderNode);
    }

    function renderNode(n) {
        var g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'node' + (n.id === selectedId ? ' selected' : ''));
        g.setAttribute('data-id', n.id);
        g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');

        var c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('class', 'node-dot');
        c.setAttribute('r', '5');
        g.appendChild(c);

        var t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('class', 'node-label');
        t.setAttribute('y', '20');
        t.setAttribute('text-anchor', 'middle');
        t.textContent = n.title || 'untitled';
        g.appendChild(t);

        nodesLayer.appendChild(g);
    }

    function nodeIdFromTarget(target) {
        var el = target && target.closest ? target.closest('.node') : null;
        return el ? el.getAttribute('data-id') : null;
    }

    function selectNode(id) {
        selectedId = id;
        nodesLayer.querySelectorAll('.node').forEach(function (g) {
            g.classList.toggle('selected', g.getAttribute('data-id') === id);
        });
    }

    function deleteNode(id) {
        nodes = nodes.filter(function (n) { return n.id !== id; });
        edges = edges.filter(function (e) { return e.fromId !== id && e.toId !== id; });
        if (selectedId === id) selectedId = null;
        renderAll();
        save();
    }

    function addNodeAt(worldX, worldY) {
        var title = window.prompt('Title for this node:');
        if (title === null) return;
        title = title.trim();
        if (!title) title = 'untitled';
        var n = {
            id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            x: worldX,
            y: worldY,
            title: title
        };
        nodes.push(n);
        renderNode(n);
        save();
    }

    // --- Pointer interactions ---
    svg.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        didDrag = false;
        var nid = nodeIdFromTarget(e.target);
        if (nid) {
            var n = nodes.find(function (x) { return x.id === nid; });
            if (!n) return;
            dragging = {
                type: 'node',
                nodeId: nid,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startNodeX: n.x,
                startNodeY: n.y
            };
            svg.classList.add('dragging-node');
        } else {
            dragging = {
                type: 'pan',
                startClientX: e.clientX,
                startClientY: e.clientY,
                startViewX: view.x,
                startViewY: view.y
            };
            svg.classList.add('panning');
        }
    });

    document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var dx = e.clientX - dragging.startClientX;
        var dy = e.clientY - dragging.startClientY;
        if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) didDrag = true;

        if (dragging.type === 'pan') {
            view.x = dragging.startViewX + dx;
            view.y = dragging.startViewY + dy;
            applyView();
        } else if (dragging.type === 'node') {
            var n = nodes.find(function (x) { return x.id === dragging.nodeId; });
            if (!n) return;
            n.x = dragging.startNodeX + dx / view.scale;
            n.y = dragging.startNodeY + dy / view.scale;
            var g = nodesLayer.querySelector('[data-id="' + cssEscape(n.id) + '"]');
            if (g) g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
        }
    });

    document.addEventListener('mouseup', function (e) {
        if (!dragging) return;
        var d = dragging;
        var wasDrag = didDrag;
        dragging = null;
        svg.classList.remove('panning', 'dragging-node');

        if (!wasDrag) {
            var nid = nodeIdFromTarget(e.target);
            if (nid) {
                selectNode(nid);
            } else {
                var w = clientToWorld(e.clientX, e.clientY);
                addNodeAt(w.x, w.y);
            }
        } else {
            save();
        }
    });

    // Wheel zoom
    svg.addEventListener('wheel', function (e) {
        e.preventDefault();
        var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        var p = svgPoint(e.clientX, e.clientY);
        var worldX = (p.x - view.x) / view.scale;
        var worldY = (p.y - view.y) / view.scale;
        view.scale = Math.max(0.2, Math.min(view.scale * factor, 6));
        view.x = p.x - worldX * view.scale;
        view.y = p.y - worldY * view.scale;
        applyView();
        save();
    }, { passive: false });

    // Keyboard
    document.addEventListener('keydown', function (e) {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
            e.preventDefault();
            deleteNode(selectedId);
        } else if (e.key === 'Escape') {
            selectNode(null);
        }
    });

    // --- Toolbar ---
    document.getElementById('btn-fit').addEventListener('click', fitToContour);
    var helpCard = document.getElementById('help-card');
    document.getElementById('btn-help').addEventListener('click', function () {
        helpCard.classList.toggle('hidden');
    });

    // CSS-escape for querySelector with arbitrary IDs
    function cssEscape(s) {
        return (s || '').replace(/(["\\])/g, '\\$1');
    }

    // --- Init ---
    if (state.view.x === 0 && state.view.y === 0 && state.view.scale === 1) {
        fitToContour();
    } else {
        applyView();
    }
    renderAll();
})();
