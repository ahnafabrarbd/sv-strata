(function () {
    'use strict';

    // --- Resolve which layer this page is editing ---
    var params = new URLSearchParams(window.location.search);
    var layerId = params.get('layer') || 'faces';
    // Back-compat aliases for old bookmarks.
    var aliases = { ideas: 'ideology', conditions: 'factory' };
    if (aliases[layerId]) layerId = aliases[layerId];
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
        if (id) showPanel(id);
        else hidePanel();
    }

    function deleteNode(id) {
        nodes = nodes.filter(function (n) { return n.id !== id; });
        edges = edges.filter(function (e) { return e.fromId !== id && e.toId !== id; });
        if (selectedId === id) { selectedId = null; hidePanel(); }
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
        var t = document.activeElement && document.activeElement.tagName;
        if (t === 'INPUT' || t === 'TEXTAREA') return;
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

    // --- Notes panel ---
    var panel = document.getElementById('notes-panel');
    var npTitle = document.getElementById('np-title');
    var npDesc = document.getElementById('np-description');
    var npImages = document.getElementById('np-images');
    var npLinks = document.getElementById('np-links');
    var npImageInput = document.getElementById('np-image-input');

    function showPanel(nodeId) {
        var n = nodes.find(function (x) { return x.id === nodeId; });
        if (!n) { hidePanel(); return; }
        panel.classList.remove('hidden');
        npTitle.value = n.title || '';
        npDesc.value = n.description || '';
        renderPanelImages(n);
        renderPanelLinks(n);
    }

    function hidePanel() {
        panel.classList.add('hidden');
    }

    function getSelectedNode() {
        return selectedId ? nodes.find(function (n) { return n.id === selectedId; }) : null;
    }

    function updateSvgLabel(n) {
        var g = nodesLayer.querySelector('[data-id="' + cssEscape(n.id) + '"]');
        if (!g) return;
        var t = g.querySelector('.node-label');
        if (t) t.textContent = n.title || 'untitled';
    }

    function renderPanelImages(n) {
        npImages.innerHTML = '';
        var imgs = n.images || [];
        imgs.forEach(function (img, idx) {
            var wrap = document.createElement('div');
            wrap.className = 'np-image-thumb';
            var image = document.createElement('img');
            image.src = img.data;
            image.alt = img.name || '';
            wrap.appendChild(image);

            var rm = document.createElement('button');
            rm.className = 'np-image-remove';
            rm.textContent = '×';
            rm.title = 'Remove image';
            rm.addEventListener('click', function () {
                n.images.splice(idx, 1);
                save();
                renderPanelImages(n);
            });
            wrap.appendChild(rm);

            npImages.appendChild(wrap);
        });
    }

    function renderPanelLinks(n) {
        npLinks.innerHTML = '';
        var links = n.links || [];
        links.forEach(function (link, idx) {
            var row = document.createElement('div');
            row.className = 'np-link-row';

            var labelInput = document.createElement('input');
            labelInput.className = 'np-link-label';
            labelInput.placeholder = 'Label';
            labelInput.value = link.label || '';
            labelInput.addEventListener('blur', function () {
                link.label = labelInput.value;
                save();
            });

            var urlInput = document.createElement('input');
            urlInput.className = 'np-link-url';
            urlInput.placeholder = 'https://…';
            urlInput.value = link.url || '';
            urlInput.addEventListener('blur', function () {
                link.url = urlInput.value;
                save();
            });

            var rm = document.createElement('button');
            rm.className = 'np-link-remove';
            rm.textContent = '×';
            rm.title = 'Remove link';
            rm.addEventListener('click', function () {
                n.links.splice(idx, 1);
                save();
                renderPanelLinks(n);
            });

            row.appendChild(labelInput);
            row.appendChild(urlInput);
            row.appendChild(rm);
            npLinks.appendChild(row);
        });
    }

    // Title syncs to canvas live; commit on blur
    npTitle.addEventListener('input', function () {
        var n = getSelectedNode();
        if (!n) return;
        n.title = npTitle.value;
        updateSvgLabel(n);
    });
    npTitle.addEventListener('blur', save);

    // Description: debounce save while typing, commit on blur
    var descSaveTimer = null;
    npDesc.addEventListener('input', function () {
        var n = getSelectedNode();
        if (!n) return;
        n.description = npDesc.value;
        clearTimeout(descSaveTimer);
        descSaveTimer = setTimeout(save, 400);
    });
    npDesc.addEventListener('blur', function () {
        clearTimeout(descSaveTimer);
        save();
    });

    npImageInput.addEventListener('change', async function (e) {
        var n = getSelectedNode();
        if (!n) return;
        if (!n.images) n.images = [];

        var files = Array.from(e.target.files);
        e.target.value = '';

        for (var i = 0; i < files.length; i++) {
            try {
                var data = await processImage(files[i]);
                n.images.push({ name: files[i].name, data: data });
            } catch (err) {
                alert('Failed to process image "' + files[i].name + '": ' + err.message);
            }
        }

        try {
            save();
        } catch (err) {
            // Likely QuotaExceededError — undo the additions
            n.images.splice(n.images.length - files.length, files.length);
            alert('Storage quota exceeded — export your data and remove some images, or use smaller files.');
        }
        renderPanelImages(n);
    });

    document.getElementById('btn-add-link').addEventListener('click', function () {
        var n = getSelectedNode();
        if (!n) return;
        if (!n.links) n.links = [];
        n.links.push({ url: '', label: '' });
        renderPanelLinks(n);
    });

    document.getElementById('btn-np-close').addEventListener('click', function () {
        selectNode(null);
    });

    document.getElementById('btn-np-delete').addEventListener('click', function () {
        if (!selectedId) return;
        if (!window.confirm('Delete this node?')) return;
        deleteNode(selectedId);
    });

    function processImage(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () {
                    var maxDim = 1000;
                    var w = img.width, h = img.height;
                    if (w > maxDim || h > maxDim) {
                        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
                        else       { w = Math.round(w * maxDim / h); h = maxDim; }
                    }
                    var canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                };
                img.onerror = reject;
                img.src = reader.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // --- Init ---
    if (state.view.x === 0 && state.view.y === 0 && state.view.scale === 1) {
        fitToContour();
    } else {
        applyView();
    }
    renderAll();
})();
