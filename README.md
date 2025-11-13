# sRGB Database

A tool for analyzing color contrast relationships across all sRGB colors.

## What it does

Generates a SQLite database of all 16.7 million sRGB colors, converts them to XYZ-D65 and OKHSL color spaces, then tests to find the minimum perceptual lightness distance that guarantees WCAG 4.5:1 contrast.

## Installation

```bash
npm install
```

## Usage

**Build TypeScript:**

```bash
npm run build
```

Compiles TypeScript files to JavaScript in the `dist/` folder.

**Create the color database:**

```bash
npm run db
```

Generates `colors.db` with all 16.7 million sRGB colors and their XYZ-D65 and OKHSL conversions.

**Analyze Y luminance ranges:**

```bash
npm run y-range
```

Analyzes the Y (luminance) distance for each OKHSL lightness group. Shows statistics about how Y values vary within each rounded lightness bucket.

**Test color contrast:**

```bash
npm run test-contrast
```

Runs the full pipeline: builds TypeScript, creates the database, precomputes lightness values, and tests random color pairs to find the minimum perceptual lightness distance that guarantees WCAG 4.5:1 contrast.

## Files generated

-   `colors.db` - SQLite database with all sRGB colors and their color space conversions
-   `lightness-values.json` - Precomputed OKHSL lightness values for 1000 steps

## What's inside

-   All 256³ sRGB colors
-   XYZ-D65 conversions
-   OKHSL (hue, saturation, lightness) values
-   Contrast testing to find safe lightness separation thresholds
