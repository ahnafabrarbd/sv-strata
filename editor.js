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
            var nodes = Array.isArray(s.nodes) ? s.nodes : [];
            // Legacy → wiki schema: copy any `description` field onto the
            // canonical `detail` field used by every wiki section.
            nodes.forEach(function (n) {
                if (n && n.description != null && n.detail == null) {
                    n.detail = n.description;
                    delete n.description;
                }
            });
            return {
                view: s.view || def.view,
                nodes: nodes,
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
        // No more SV outline — fit to the bounding box of the existing nodes,
        // or center on (0, 0) at scale 1 when empty.
        var rect = svg.getBoundingClientRect();
        if (!nodes.length) {
            view.scale = 1;
            view.x = rect.width / 2;
            view.y = rect.height / 2;
        } else {
            var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            nodes.forEach(function (n) {
                if (n.x < minX) minX = n.x;
                if (n.x > maxX) maxX = n.x;
                if (n.y < minY) minY = n.y;
                if (n.y > maxY) maxY = n.y;
            });
            var pad = 80;
            var w = Math.max(1, maxX - minX);
            var h = Math.max(1, maxY - minY);
            var sx = (rect.width  - pad * 2) / w;
            var sy = (rect.height - pad * 2) / h;
            view.scale = Math.min(2, Math.max(0.3, Math.min(sx, sy, 1.4)));
            view.x = rect.width  / 2 - ((minX + maxX) / 2) * view.scale;
            view.y = rect.height / 2 - ((minY + maxY) / 2) * view.scale;
        }
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

        var primary = (n.images && n.images.length) ? n.images[0] : null;
        if (primary && primary.data) {
            // Image-as-node-face: render the node's primary picture as a
            // round avatar instead of the green dot. The frame ring above
            // it preserves the layer's accent on hover/select.
            var R = 18;
            var fo = document.createElementNS(SVG_NS, 'foreignObject');
            fo.setAttribute('x', -R);
            fo.setAttribute('y', -R);
            fo.setAttribute('width', R * 2);
            fo.setAttribute('height', R * 2);
            var img = document.createElementNS('http://www.w3.org/1999/xhtml', 'img');
            img.setAttribute('src', primary.data);
            img.setAttribute('alt', '');
            img.style.cssText =
                'width:' + (R * 2) + 'px;height:' + (R * 2) + 'px;' +
                'object-fit:cover;border-radius:50%;display:block;pointer-events:none;';
            fo.appendChild(img);
            g.appendChild(fo);

            var ring = document.createElementNS(SVG_NS, 'circle');
            ring.setAttribute('class', 'node-frame');
            ring.setAttribute('r', R);
            g.appendChild(ring);
        } else {
            var c = document.createElementNS(SVG_NS, 'circle');
            c.setAttribute('class', 'node-dot');
            c.setAttribute('r', '5');
            g.appendChild(c);
        }

        var t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('class', 'node-label');
        t.setAttribute('y', primary ? '34' : '20');
        t.setAttribute('text-anchor', 'middle');
        t.textContent = n.title || 'untitled';
        g.appendChild(t);

        nodesLayer.appendChild(g);
    }

    function rerenderNode(n) {
        // Drop the existing SVG group and rebuild it — used when something
        // structural changes (e.g. the node gains or loses its primary
        // image, switching between dot and image-as-face).
        var existing = nodesLayer.querySelector('[data-id="' + cssEscape(n.id) + '"]');
        if (existing) existing.remove();
        renderNode(n);
        if (n.id === selectedId) {
            var fresh = nodesLayer.querySelector('[data-id="' + cssEscape(n.id) + '"]');
            if (fresh) fresh.classList.add('selected');
        }
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
        var u = (window.SVAuth && window.SVAuth.currentUser) ? window.SVAuth.currentUser() : null;
        var n = {
            id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            x: worldX,
            y: worldY,
            title: title,
            createdBy: (u && u.username) || 'anon',
            createdAt: new Date().toISOString()
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
    var npByline = document.getElementById('np-byline');
    var npGenealogy = document.getElementById('np-genealogy');
    var npHistory = document.getElementById('np-history');
    var npDetail = document.getElementById('np-detail');
    var npSpecial = document.getElementById('np-special');
    var npImages = document.getElementById('np-images');
    var npLinks = document.getElementById('np-links');
    var npComments = document.getElementById('np-comments');
    var npCommentInput = document.getElementById('np-comment-input');
    var npCommentForm = document.getElementById('np-comment-form');
    var npImageInput = document.getElementById('np-image-input');

    // Backfill wiki fields onto a node so the textareas / lists never see
    // undefined values. Mutates in place; the caller still owns the node.
    function ensureWikiFields(n) {
        if (!n) return n;
        if (n.genealogy == null) n.genealogy = '';
        if (n.history   == null) n.history   = '';
        if (n.detail    == null) n.detail    = n.description != null ? n.description : '';
        if (n.special   == null) n.special   = '';
        if (!Array.isArray(n.images))   n.images   = [];
        if (!Array.isArray(n.links))    n.links    = [];
        if (!Array.isArray(n.comments)) n.comments = [];
        if (!n.createdBy) {
            var u = (window.SVAuth && window.SVAuth.currentUser) ? window.SVAuth.currentUser() : null;
            n.createdBy = (u && u.username) || 'unknown';
        }
        if (!n.createdAt) n.createdAt = new Date().toISOString();
        if (n.description != null) delete n.description;
        return n;
    }

    function renderByline(n) {
        var dt = new Date(n.createdAt);
        var stamp = isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
        npByline.innerHTML =
            'by <span class="np-byline-user">@' + escapeHtml(n.createdBy) + '</span>' +
            (stamp ? ' · created ' + stamp : '');
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function showPanel(nodeId) {
        var n = nodes.find(function (x) { return x.id === nodeId; });
        if (!n) { hidePanel(); return; }
        ensureWikiFields(n);
        panel.classList.remove('hidden');
        npTitle.value      = n.title     || '';
        npGenealogy.value  = n.genealogy || '';
        npHistory.value    = n.history   || '';
        npDetail.value     = n.detail    || '';
        npSpecial.value    = n.special   || '';
        renderByline(n);
        renderPanelImages(n);
        renderPanelLinks(n);
        renderPanelComments(n);
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
            wrap.className = 'np-image-thumb' + (idx === 0 ? ' primary' : '');
            var image = document.createElement('img');
            image.src = img.data;
            image.alt = img.name || '';
            wrap.appendChild(image);

            if (idx === 0) {
                var tag = document.createElement('span');
                tag.className = 'np-image-thumb-primary-tag';
                tag.textContent = 'FACE';
                wrap.appendChild(tag);
            } else {
                var promote = document.createElement('button');
                promote.className = 'np-image-thumb-promote';
                promote.type = 'button';
                promote.textContent = 'Make face';
                promote.title = 'Use this image as the node face';
                promote.addEventListener('click', function () {
                    var moved = n.images.splice(idx, 1)[0];
                    n.images.unshift(moved);
                    save();
                    renderPanelImages(n);
                    rerenderNode(n);
                });
                wrap.appendChild(promote);
            }

            var rm = document.createElement('button');
            rm.className = 'np-image-remove';
            rm.textContent = '×';
            rm.title = 'Remove image';
            rm.addEventListener('click', function () {
                n.images.splice(idx, 1);
                save();
                renderPanelImages(n);
                rerenderNode(n);
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

    // Each wiki textarea: live-write the field on input (debounced save),
    // commit on blur. Same pattern across genealogy / history / detail /
    // special so they're interchangeable.
    function bindWikiField(el, field) {
        var t = null;
        el.addEventListener('input', function () {
            var n = getSelectedNode();
            if (!n) return;
            n[field] = el.value;
            clearTimeout(t);
            t = setTimeout(save, 400);
        });
        el.addEventListener('blur', function () {
            clearTimeout(t);
            save();
        });
    }
    bindWikiField(npGenealogy, 'genealogy');
    bindWikiField(npHistory,   'history');
    bindWikiField(npDetail,    'detail');
    bindWikiField(npSpecial,   'special');

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
        rerenderNode(n);
    });

    document.getElementById('btn-add-link').addEventListener('click', function () {
        var n = getSelectedNode();
        if (!n) return;
        if (!n.links) n.links = [];
        n.links.push({ url: '', label: '' });
        renderPanelLinks(n);
    });

    function renderPanelComments(n) {
        npComments.innerHTML = '';
        var items = (n.comments || []);
        if (!items.length) {
            var empty = document.createElement('div');
            empty.className = 'np-comments-empty';
            empty.textContent = 'No comments yet.';
            npComments.appendChild(empty);
            return;
        }
        // Newest first.
        items.slice().reverse().forEach(function (c) {
            var wrap = document.createElement('div');
            wrap.className = 'np-comment';

            var head = document.createElement('div');
            head.className = 'np-comment-head';
            var user = document.createElement('span');
            user.className = 'np-comment-user';
            user.textContent = '@' + (c.author || 'anon');
            var stamp = document.createElement('span');
            stamp.className = 'np-comment-stamp';
            var dt = new Date(c.createdAt);
            stamp.textContent = isNaN(dt.getTime()) ? '' : dt.toLocaleString();
            head.appendChild(user);
            head.appendChild(stamp);

            var body = document.createElement('div');
            body.className = 'np-comment-body';
            body.textContent = c.text;

            wrap.appendChild(head);
            wrap.appendChild(body);
            npComments.appendChild(wrap);
        });
    }

    npCommentForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var n = getSelectedNode();
        if (!n) return;
        var text = (npCommentInput.value || '').trim();
        if (!text) return;
        var u = (window.SVAuth && window.SVAuth.currentUser) ? window.SVAuth.currentUser() : null;
        if (!Array.isArray(n.comments)) n.comments = [];
        n.comments.push({
            author: (u && u.username) || 'anon',
            text: text,
            createdAt: new Date().toISOString()
        });
        save();
        npCommentInput.value = '';
        renderPanelComments(n);
    });

    // Cross-tab sync — if the same layer storage key is updated in
    // another tab, refresh the open panel so newly-posted comments and
    // edits appear without a manual reload.
    window.addEventListener('storage', function (e) {
        if (e.key !== STORAGE_KEY) return;
        var fresh = loadState();
        nodes = fresh.nodes;
        edges = fresh.edges;
        view = fresh.view;
        renderAll();
        applyView();
        if (selectedId) {
            var n = nodes.find(function (x) { return x.id === selectedId; });
            if (n) showPanel(n.id);
            else { selectedId = null; hidePanel(); }
        }
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
