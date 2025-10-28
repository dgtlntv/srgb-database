import { existsSync, writeFileSync } from "fs";
// ========== Constants ==========
const CONFIG = {
    OUTPUT_FILE: "lightness-values.json",
    SCALE_MAX: 1000,
    LIGHTNESS_PRECISION: 100,
    WCAG_MAX_CONTRAST: 21,
    WCAG_LUMINANCE_OFFSET: 0.05,
    WCAG_THRESHOLD: 0.18,
    PROGRESS_INTERVAL: 100,
};
const D65_WHITE_POINT = {
    X: 0.3127,
    Y: 0.329,
    Z_FACTOR: (1 - 0.3127 - 0.329) / 0.329,
    X_FACTOR: 0.3127 / 0.329,
};
const TOE_CONSTANTS = {
    K1: 0.206,
    K2: 0.03,
    K3: (1 + 0.206) / (1 + 0.03),
};
// XYZ to LMS transformation matrix for Oklab color space
const XYZ_TO_LMS_MATRIX = [
    [+0.8189330101, +0.3618667424, -0.1288597137],
    [+0.0329845436, +0.9293118715, +0.0361456387],
    [+0.0482003018, +0.2643662691, +0.633851707],
];
// LMS to Oklab transformation matrix
const LMS_TO_OKLAB_MATRIX = [
    [+0.2104542553, +0.793617785, -0.0040720468],
    [+1.9779984951, -2.428592205, +0.4505937099],
    [+0.0259040371, +0.7827717662, -0.808675766],
];
// ========== WCAG Contrast Functions ==========
/**
 * Converts a scale value (0-1000) to a WCAG contrast ratio (1-21)
 * Uses exponential mapping for perceptually uniform distribution
 * @param scaleValue - Scale value from 0 to 1000
 * @returns WCAG contrast ratio from 1 to 21
 */
function scaleToContrast(scaleValue) {
    const normalizedValue = scaleValue / CONFIG.SCALE_MAX;
    return Math.exp(Math.log(CONFIG.WCAG_MAX_CONTRAST) * normalizedValue);
}
/**
 * Calculates the luminance needed to achieve a target contrast ratio against a reference luminance
 * Implements the inverse of the WCAG contrast formula
 * @param contrast - Target contrast ratio (1-21)
 * @param y - Reference luminance value (0-1)
 * @returns Calculated luminance value (0-1)
 * @throws Error if inputs are out of valid ranges
 */
function reverseWCAGContrast(contrast = 4.5, y = 1) {
    if (!(y >= 0 && y <= 1)) {
        throw new Error(`Invalid luminance value: ${y} (must be between 0 and 1)`);
    }
    if (!(contrast >= 1 && contrast <= CONFIG.WCAG_MAX_CONTRAST)) {
        throw new Error(`Invalid contrast ratio: ${contrast} (must be between 1 and ${CONFIG.WCAG_MAX_CONTRAST})`);
    }
    let output;
    if (y > CONFIG.WCAG_THRESHOLD) {
        output = (y + CONFIG.WCAG_LUMINANCE_OFFSET) / contrast - CONFIG.WCAG_LUMINANCE_OFFSET;
    }
    else {
        output = contrast * (y + CONFIG.WCAG_LUMINANCE_OFFSET) - CONFIG.WCAG_LUMINANCE_OFFSET;
    }
    return Math.max(0, Math.min(1, output));
}
// ========== Color Space Conversion Functions ==========
/**
 * Converts CIE Y luminance to Oklab lightness
 * Transforms through XYZ → LMS → Oklab color spaces
 * @param inputY - CIE Y luminance value (0-1)
 * @returns Oklab lightness value
 */
function yToOklabLightness(inputY) {
    // Convert Y to XYZ using D65 white point
    const X = D65_WHITE_POINT.X_FACTOR * inputY;
    const Y = inputY;
    const Z = D65_WHITE_POINT.Z_FACTOR * inputY;
    // Apply XYZ to LMS transformation
    let l = XYZ_TO_LMS_MATRIX[0][0] * X +
        XYZ_TO_LMS_MATRIX[0][1] * Y +
        XYZ_TO_LMS_MATRIX[0][2] * Z;
    let m = XYZ_TO_LMS_MATRIX[1][0] * X +
        XYZ_TO_LMS_MATRIX[1][1] * Y +
        XYZ_TO_LMS_MATRIX[1][2] * Z;
    let s = XYZ_TO_LMS_MATRIX[2][0] * X +
        XYZ_TO_LMS_MATRIX[2][1] * Y +
        XYZ_TO_LMS_MATRIX[2][2] * Z;
    // Ensure non-negative values
    l = Math.max(0, l);
    m = Math.max(0, m);
    s = Math.max(0, s);
    // Apply cube root transformation
    const l_prime = Math.cbrt(l);
    const m_prime = Math.cbrt(m);
    const s_prime = Math.cbrt(s);
    // Apply LMS to Oklab transformation
    const L = LMS_TO_OKLAB_MATRIX[0][0] * l_prime +
        LMS_TO_OKLAB_MATRIX[0][1] * m_prime +
        LMS_TO_OKLAB_MATRIX[0][2] * s_prime;
    return L;
}
/**
 * Applies the toe function for perceptual uniformity in OKHSL
 * Provides smooth transition in the darker tones
 * @param L - Oklab lightness value
 * @returns Perceptually adjusted lightness
 */
function toe(L) {
    const k3L_m_k1 = TOE_CONSTANTS.K3 * L - TOE_CONSTANTS.K1;
    return (0.5 *
        (k3L_m_k1 + Math.sqrt(k3L_m_k1 * k3L_m_k1 + 4 * TOE_CONSTANTS.K2 * TOE_CONSTANTS.K3 * L)));
}
/**
 * Converts CIE Y luminance to OKHSL lightness
 * Combines Oklab transformation with toe function
 * @param inputY - CIE Y luminance value (0-1)
 * @returns OKHSL lightness value
 */
function yToOkhslLightness(inputY) {
    return toe(yToOklabLightness(inputY));
}
// ========== Computation Functions ==========
/**
 * Computes the OKHSL lightness value for a given step in the scale
 * Combines WCAG contrast calculation with color space conversion
 * @param step - Step value from 0 to 1000
 * @returns Computed OKHSL lightness value
 */
function computeLightness(step) {
    const wcagContrast = scaleToContrast(step);
    const targetLuminance = reverseWCAGContrast(wcagContrast);
    return yToOkhslLightness(targetLuminance);
}
/**
 * Computes all lightness values for the scale and returns the mapping
 * @returns Record mapping step numbers to rounded lightness values
 */
function computeAllLightnessValues() {
    const lightnessValues = {};
    for (let step = 0; step <= CONFIG.SCALE_MAX; step++) {
        const lightness = computeLightness(step);
        const roundedLightness = Math.round(lightness * CONFIG.LIGHTNESS_PRECISION) / CONFIG.LIGHTNESS_PRECISION;
        lightnessValues[step] = roundedLightness;
        if (step % CONFIG.PROGRESS_INTERVAL === 0) {
            console.log(`Step ${step}: lightness = ${lightness.toFixed(6)} (rounded: ${roundedLightness})`);
        }
    }
    return lightnessValues;
}
/**
 * Saves lightness values to a JSON file
 * @param lightnessValues - Record of step to lightness mappings
 * @param outputFile - Path to output file
 */
function saveLightnessValues(lightnessValues, outputFile) {
    writeFileSync(outputFile, JSON.stringify(lightnessValues, null, 2));
    console.log(`\n✓ Saved to ${outputFile}`);
    console.log(`  Total steps: ${Object.keys(lightnessValues).length}`);
}
// ========== Main Function ==========
/**
 * Main function that precomputes and saves lightness values
 */
function main() {
    const outputFile = CONFIG.OUTPUT_FILE;
    if (existsSync(outputFile)) {
        console.log(`✓ Lightness values file already exists: ${outputFile}`);
        console.log(`Skipping computation.`);
        return;
    }
    console.log("=== Precomputing Lightness Values ===\n");
    const lightnessValues = computeAllLightnessValues();
    console.log("\n✓ All lightness values computed");
    saveLightnessValues(lightnessValues, outputFile);
}
main();
