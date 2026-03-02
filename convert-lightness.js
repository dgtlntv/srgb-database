function toeInv(x) {
    const k1 = 0.206;
    const k2 = 0.03;
    const k3 = (1 + k1) / (1 + k2);
    return (x * x + k1 * x) / (k3 * (x + k2));
}

const okhslValues = [
    0.96, 0.1, 0.94, 0.14, 0.96, 0.1,
    0.95, 0.13, 0.93, 0.16, 0.95, 0.13,
    0.94, 0.14, 0.96, 0.1, 0.94, 0.14,
    0.98, 0.09, 1, 0.04, 0.98, 0.09,
    0.45, 0.51, 0.44, 0.53, 0.75, 0.32,
    0.85, 0.27, 0.84, 0.28,
    0.33, 0.77
];

console.log("┌──────────────┬──────────────┐");
console.log("│  OKHSL L     │  Oklab L     │");
console.log("├──────────────┼──────────────┤");

for (const okhslL of okhslValues) {
    const oklabL = toeInv(okhslL);
    console.log(`│  ${okhslL.toFixed(2).padEnd(10)} │  ${oklabL.toFixed(2).padEnd(10)} │`);
}

console.log("└──────────────┴──────────────┘");
