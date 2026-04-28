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
    var edgesLayer = document.getElementById('edges-layer');
    var banner = document.getElementById('banner');
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

    var connectMode = false;
    var pendingFromId = null;

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
        while (edgesLayer.firstChild) edgesLayer.removeChild(edgesLayer.firstChild);
        while (nodesLayer.firstChild) nodesLayer.removeChild(nodesLayer.firstChild);
        edges.forEach(renderEdge);
        nodes.forEach(renderNode);
    }

    function renderEdge(e) {
        var fromNode = nodes.find(function (n) { return n.id === e.fromId; });
        var toNode = nodes.find(function (n) { return n.id === e.toId; });
        if (!fromNode || !toNode) return;

        var g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'edge');
        g.setAttribute('data-id', e.id);

        var hit = document.createElementNS(SVG_NS, 'line');
        hit.setAttribute('class', 'edge-hit');
        hit.setAttribute('x1', fromNode.x); hit.setAttribute('y1', fromNode.y);
        hit.setAttribute('x2', toNode.x);   hit.setAttribute('y2', toNode.y);
        g.appendChild(hit);

        var line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'edge-line');
        line.setAttribute('x1', fromNode.x); line.setAttribute('y1', fromNode.y);
        line.setAttribute('x2', toNode.x);   line.setAttribute('y2', toNode.y);
        g.appendChild(line);

        var label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('class', 'edge-label');
        label.setAttribute('x', (fromNode.x + toNode.x) / 2);
        label.setAttribute('y', (fromNode.y + toNode.y) / 2 - 4);
        label.setAttribute('text-anchor', 'middle');
        label.textContent = e.label || '';
        g.appendChild(label);

        edgesLayer.appendChild(g);
    }

    function updateEdgesForNode(nodeId) {
        edges.forEach(function (e) {
            if (e.fromId !== nodeId && e.toId !== nodeId) return;
            var g = edgesLayer.querySelector('[data-id="' + cssEscape(e.id) + '"]');
            if (!g) return;
            var fromNode = nodes.find(function (n) { return n.id === e.fromId; });
            var toNode = nodes.find(function (n) { return n.id === e.toId; });
            if (!fromNode || !toNode) return;
            g.querySelectorAll('line').forEach(function (ln) {
                ln.setAttribute('x1', fromNode.x); ln.setAttribute('y1', fromNode.y);
                ln.setAttribute('x2', toNode.x);   ln.setAttribute('y2', toNode.y);
            });
            var lbl = g.querySelector('.edge-label');
            if (lbl) {
                lbl.setAttribute('x', (fromNode.x + toNode.x) / 2);
                lbl.setAttribute('y', (fromNode.y + toNode.y) / 2 - 4);
            }
        });
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

    function edgeIdFromTarget(target) {
        var el = target && target.closest ? target.closest('.edge') : null;
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
        if (pendingFromId === id) { pendingFromId = null; updateBanner(); }
        renderAll();
        save();
    }

    function deleteEdge(id) {
        edges = edges.filter(function (e) { return e.id !== id; });
        var g = edgesLayer.querySelector('[data-id="' + cssEscape(id) + '"]');
        if (g) g.remove();
        save();
    }

    function editEdgeLabel(id) {
        var e = edges.find(function (x) { return x.id === id; });
        if (!e) return;
        var next = window.prompt('Edge label (empty to remove label):', e.label || '');
        if (next === null) return;
        e.label = next.trim();
        var g = edgesLayer.querySelector('[data-id="' + cssEscape(id) + '"]');
        if (g) {
            var lbl = g.querySelector('.edge-label');
            if (lbl) lbl.textContent = e.label;
        }
        save();
    }

    function createEdge(fromId, toId) {
        if (fromId === toId) return;
        var existing = edges.find(function (e) {
            return (e.fromId === fromId && e.toId === toId) ||
                   (e.fromId === toId && e.toId === fromId);
        });
        if (existing) return;
        var label = window.prompt('Label for this connection (optional):', '') || '';
        var e = {
            id: 'e_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            fromId: fromId,
            toId: toId,
            label: label.trim()
        };
        edges.push(e);
        renderEdge(e);
        save();
    }

    function toggleConnectMode() {
        connectMode = !connectMode;
        document.getElementById('btn-connect').classList.toggle('on', connectMode);
        pendingFromId = null;
        updatePendingHighlight();
        updateBanner();
    }

    function updatePendingHighlight() {
        nodesLayer.querySelectorAll('.node').forEach(function (g) {
            g.classList.toggle('pending', g.getAttribute('data-id') === pendingFromId);
        });
    }

    function updateBanner() {
        if (!connectMode) {
            banner.classList.add('hidden');
            return;
        }
        banner.classList.remove('hidden');
        banner.textContent = pendingFromId
            ? 'Click a second node to connect'
            : 'Connect mode — click two nodes';
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
        if (nid && !connectMode) {
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
        } else if (nid && connectMode) {
            // Click-only — don't drag in connect mode
            dragging = {
                type: 'click',
                startClientX: e.clientX,
                startClientY: e.clientY
            };
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
            updateEdgesForNode(n.id);
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
            var eid = edgeIdFromTarget(e.target);

            if (connectMode && nid) {
                if (!pendingFromId) {
                    pendingFromId = nid;
                    updatePendingHighlight();
                    updateBanner();
                } else if (pendingFromId === nid) {
                    pendingFromId = null;
                    updatePendingHighlight();
                    updateBanner();
                } else {
                    var fromId = pendingFromId;
                    pendingFromId = null;
                    updatePendingHighlight();
                    createEdge(fromId, nid);
                    updateBanner();
                }
                return;
            }

            // Cancel pending if user clicks empty/edge while in connect mode
            if (connectMode && !nid) {
                if (pendingFromId) {
                    pendingFromId = null;
                    updatePendingHighlight();
                    updateBanner();
                }
                return;
            }

            if (nid) {
                selectNode(nid);
            } else if (eid) {
                if (e.shiftKey) {
                    if (window.confirm('Delete this connection?')) deleteEdge(eid);
                } else {
                    editEdgeLabel(eid);
                }
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
    document.getElementById('btn-connect').addEventListener('click', toggleConnectMode);
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
