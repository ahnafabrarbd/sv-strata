// Stylized contour resembling the elongated NW-SE peninsula of Silicon Valley.
// Designed for a 600x600 viewBox; scale via viewBox/transform.
// Hand-drawn, not GIS-accurate. The eastward indentation suggests the Bay.
window.SV_PATH = "M 110,30 C 175,10 250,18 310,55 C 365,90 410,135 440,180 C 460,215 460,245 432,265 C 408,282 408,302 438,328 C 472,360 488,402 460,440 C 422,485 348,510 275,510 C 200,510 130,488 82,440 C 36,390 18,310 30,230 C 42,140 70,75 110,30 Z";

window.SV_LAYERS = [
    { id: 'faces',      title: 'FACES',      subtitle: 'Surface stratum',     placeholder: 'The front-facing figures of Silicon Valley — founders, personalities, the public face of capital. Click to edit this note.' },
    { id: 'ideas',      title: 'IDEAS',      subtitle: 'Middle stratum',      placeholder: 'Ideologies and their genealogies. The doctrines that shape what the surface believes. Click to edit this note.' },
    { id: 'conditions', title: 'CONDITIONS', subtitle: 'Mariana stratum',     placeholder: 'The material conditions — capital flows, supply chains, infrastructure, labor — that let the upper strata exist. Click to edit this note.' }
];
