// Exact calculation from repo
const D65_X_FACTOR = 0.3127 / 0.329;
const D65_Z_FACTOR = (1 - 0.3127 - 0.329) / 0.329;

const XYZ_TO_LMS = [
    [+0.8189330101, +0.3618667424, -0.1288597137],
    [+0.0329845436, +0.9293118715, +0.0361456387],
    [+0.0482003018, +0.2643662691, +0.633851707],
];

const LMS_TO_OKLAB = [
    [+0.2104542553, +0.793617785, -0.0040720468],
    [+1.9779984951, -2.428592205, +0.4505937099],
    [+0.0259040371, +0.7827717662, -0.808675766],
];

function exactOklabL(Y) {
    const X = D65_X_FACTOR * Y;
    const Z = D65_Z_FACTOR * Y;

    let l = XYZ_TO_LMS[0][0] * X + XYZ_TO_LMS[0][1] * Y + XYZ_TO_LMS[0][2] * Z;
    let m = XYZ_TO_LMS[1][0] * X + XYZ_TO_LMS[1][1] * Y + XYZ_TO_LMS[1][2] * Z;
    let s = XYZ_TO_LMS[2][0] * X + XYZ_TO_LMS[2][1] * Y + XYZ_TO_LMS[2][2] * Z;

    l = Math.max(0, l);
    m = Math.max(0, m);
    s = Math.max(0, s);

    const l_prime = Math.cbrt(l);
    const m_prime = Math.cbrt(m);
    const s_prime = Math.cbrt(s);

    return LMS_TO_OKLAB[0][0] * l_prime + LMS_TO_OKLAB[0][1] * m_prime + LMS_TO_OKLAB[0][2] * s_prime;
}

// Simplified formula (Google Sheets compatible)
function simplifiedOklabL(Y) {
    return Math.pow(Y, 1/3);
}

// Full pipeline
function stepToY(step) {
    const contrast = Math.exp(Math.log(21) * step / 1000);
    return Math.max(0, Math.min(1, 1.05 / contrast - 0.05));
}

console.log("┌────────┬────────────┬────────────┬────────────┬───────────┐");
console.log("│  Step  │  Y (lum)   │  Exact L   │  Simple L  │   Error   │");
console.log("├────────┼────────────┼────────────┼────────────┼───────────┤");

for (const step of [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]) {
    const Y = stepToY(step);
    const exact = exactOklabL(Y);
    const simple = simplifiedOklabL(Y);
    const error = Math.abs(exact - simple);
    console.log(`│  ${String(step).padStart(4)} │  ${Y.toFixed(6).padStart(8)} │  ${exact.toFixed(6).padStart(8)} │  ${simple.toFixed(6).padStart(8)} │  ${error.toFixed(8)} │`);
}

console.log("└────────┴────────────┴────────────┴────────────┴───────────┘");
