// Idempotent localStorage migration. Runs at the top of every page so old data
// (saved under the orange-era ids 'ideas' / 'conditions') survives the rename
// to 'ideology' / 'factory'. Safe to run repeatedly.
(function () {
    'use strict';

    var renames = {
        'sv-strata.notes.ideas':       'sv-strata.notes.ideology',
        'sv-strata.notes.conditions':  'sv-strata.notes.factory',
        'sv-strata.layer.ideas':       'sv-strata.layer.ideology',
        'sv-strata.layer.conditions':  'sv-strata.layer.factory'
    };
    Object.keys(renames).forEach(function (oldKey) {
        var newKey = renames[oldKey];
        var oldVal = localStorage.getItem(oldKey);
        if (oldVal !== null && localStorage.getItem(newKey) === null) {
            localStorage.setItem(newKey, oldVal);
            localStorage.removeItem(oldKey);
        }
    });

    // Migrate the lattice's stored plane state: rename plane ids and linkedLayer
    // refs, and re-point any nodes whose planeId pointed at the old plane id.
    var latticeKey = 'sv-strata.lattice';
    var raw = localStorage.getItem(latticeKey);
    if (raw) {
        try {
            var data = JSON.parse(raw);
            var planeRenames = {
                'plane_ideas':      'plane_ideology',
                'plane_conditions': 'plane_factory'
            };
            var layerRenames = {
                'ideas':      'ideology',
                'conditions': 'factory'
            };
            var labelRenames = {
                'IDEAS':      'IDEOLOGY',
                'CONDITIONS': 'FACTORY'
            };
            var changed = false;

            if (Array.isArray(data.planes)) {
                data.planes.forEach(function (p) {
                    if (planeRenames[p.id]) { p.id = planeRenames[p.id]; changed = true; }
                    if (layerRenames[p.linkedLayer]) { p.linkedLayer = layerRenames[p.linkedLayer]; changed = true; }
                    if (labelRenames[p.label]) { p.label = labelRenames[p.label]; changed = true; }
                });
            }
            if (Array.isArray(data.nodes)) {
                data.nodes.forEach(function (n) {
                    if (planeRenames[n.planeId]) { n.planeId = planeRenames[n.planeId]; changed = true; }
                });
            }
            if (changed) localStorage.setItem(latticeKey, JSON.stringify(data));
        } catch (e) {
            // Corrupt JSON — leave it alone; lattice loader will fall back to defaults.
        }
    }
})();
