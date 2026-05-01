// High-resolution contour of the Silicon Valley peninsula.
// Designed for a 600x600 viewBox; scale via viewBox/transform.
// Hand-drawn with characteristic Bay-side features:
//  • Brisbane lagoon indent
//  • SFO bump
//  • Coyote Point
//  • Foster City rectangular bump
//  • Redwood Shores
//  • Bair Island
//  • Dumbarton notch
//  • Mountain View shoreline
//  • Alviso slough (deep indent)
//  • San Jose taper
// West side: Santa Cruz / Skyline ridge with Half Moon Bay scallop.
window.SV_PATH = [
    // Start at SF NW (Marina), trace clockwise.
    "M 175,30",
    "C 192,24 212,22 232,24",
    "C 250,26 268,32 282,42",
    "C 292,49 300,58 304,68",
    "C 308,78 304,88 296,94",
    "C 290,98 286,102 290,108",
    "C 296,114 304,118 312,124",
    // Hunters Point bulge
    "C 322,130 330,138 334,148",
    "C 336,156 332,164 326,168",
    // Brisbane lagoon indent (inward)
    "C 318,170 308,166 302,158",
    "C 298,164 302,172 310,180",
    // South SF / SFO approach
    "C 322,190 334,200 344,212",
    // SFO bump (east)
    "C 354,222 364,228 372,238",
    "C 378,246 380,254 376,260",
    // Coyote Point bump
    "C 380,266 388,270 394,274",
    "C 400,278 402,284 396,288",
    // Foster City rectangular peninsula
    "L 404,294",
    "L 416,294",
    "L 418,308",
    "L 416,322",
    "L 402,324",
    "L 398,332",
    // Redwood Shores
    "L 410,336",
    "L 414,348",
    "L 408,354",
    "L 400,354",
    // Bair Island marsh
    "C 404,360 410,366 414,374",
    "C 418,382 420,392 418,400",
    // Dumbarton notch (inward)
    "C 414,406 406,408 400,402",
    "C 402,412 408,420 414,430",
    // Mountain View shoreline
    "C 420,440 424,452 422,464",
    // Moffett curve
    "C 418,472 410,478 402,480",
    // Sunnyvale shoreline
    "C 396,486 394,494 388,498",
    // Alviso slough (deep inward indent)
    "C 380,500 372,496 366,488",
    "C 360,494 360,502 366,508",
    // San Jose tip taper
    "C 360,516 350,520 338,520",
    "C 324,520 310,516 298,508",
    "C 286,500 276,488 270,476",
    // South curve around San Jose
    "C 264,464 260,452 256,438",
    "C 252,422 246,406 238,392",
    // Los Gatos foothills (SW)
    "C 230,378 220,366 208,356",
    "C 196,344 184,330 174,316",
    // Saratoga / Cupertino foothills
    "C 164,300 156,284 148,266",
    "C 140,248 132,230 124,212",
    // Stanford / Palo Alto foothills
    "C 116,194 108,176 102,158",
    // Crystal Springs reservoir indent (slight inward on west)
    "C 96,142 92,128 96,114",
    "C 100,100 108,90 116,82",
    // Skyline ridge (smooth)
    "C 122,74 124,66 122,58",
    // Half Moon Bay scallop (slight outward)
    "C 124,52 130,50 134,54",
    "C 132,46 134,40 140,36",
    // Pacifica / Daly City coast
    "C 148,30 158,28 165,30",
    "C 169,29 172,29 175,30",
    "Z"
].join(" ");

window.SV_LAYERS = [
    { id: 'faces',    title: 'FACES',    subtitle: 'Surface stratum',  hologram: 'mask',    placeholder: 'The front-facing figures — founders, personalities, the public face of capital. Click to edit this note.' },
    { id: 'ideology', title: 'IDEOLOGY', subtitle: 'Middle stratum',   hologram: 'network', placeholder: 'The doctrines, axioms, and accepted principles — the lattice of ideas that shapes what the surface believes. Click to edit this note.' },
    { id: 'factory',  title: 'FACTORY',  subtitle: 'Mariana stratum',  hologram: 'factory', placeholder: 'The material conditions and source code — capital flows, supply chains, infrastructure, labour — that let the upper strata exist. Click to edit this note.' }
];
