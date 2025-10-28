import Database from "better-sqlite3"
import { BloomFilter } from "bloom-filters"
import { existsSync, readFileSync } from "fs"
import wcagContrast from "wcag-contrast"

// ========== Type Definitions ==========

interface Color {
    readonly r: number
    readonly g: number
    readonly b: number
    readonly y: number
    readonly rounded_ok_l: number
}

interface DatabaseCountResult {
    count: number
}

interface LightnessValues {
    [key: number]: number
}

interface TestState {
    distance: number
    testCount: number
    totalTestsRun: number
    testedCombinations: BloomFilter
}

// ========== Constants ==========

const CONFIG = {
    DEFAULT_DB_PATH: "colors.db",
    LIGHTNESS_VALUES_FILE: "lightness-values.json",
    RGB_MULTIPLIERS: {
        RED: 65536,
        GREEN: 256,
        BLUE: 1,
    },
    BLOOM_FILTER: {
        EXPECTED_ITEMS: 100_000_000,
        FALSE_POSITIVE_RATE: 0.001,
    },
    CONTRAST: {
        MIN_RATIO: 4.5,
        INITIAL_DISTANCE: 571,
    },
    PROGRESS: {
        LOAD_UPDATE_INTERVAL: 500_000,
        TEST_UPDATE_INTERVAL: 50_000,
    },
    LIGHTNESS: {
        MAX_STEP: 1000,
        MIN_STEP: 0,
        SAMPLE_DISPLAY_INTERVAL: 200,
    },
    TEST: {
        MAX_TESTS: 100_000_000,
    },
} as const

const SQL_QUERIES = {
    COUNT_COLORS: "SELECT COUNT(*) as count FROM colors",
    SELECT_ALL_COLORS: "SELECT r, g, b, y, rounded_ok_l FROM colors",
} as const

// ========== Validation Functions ==========

/**
 * Gets the database path from command line arguments or returns the default path
 * @returns The database file path
 */
function getDatabasePath(): string {
    return process.argv[2] ?? CONFIG.DEFAULT_DB_PATH
}

/**
 * Validates that all required files exist
 * @param dbPath - Path to the database file
 * @throws Exits process if any required file is missing
 */
function validateRequiredFiles(dbPath: string): void {
    if (!existsSync(dbPath)) {
        console.error(`❌ Error: Database file not found at: ${dbPath}`)
        console.error(
            `\nUsage: node test-color-contrast.js [path/to/colors.db]`
        )
        console.error(`Example: node test-color-contrast.js ../colors.db`)
        process.exit(1)
    }

    if (!existsSync(CONFIG.LIGHTNESS_VALUES_FILE)) {
        console.error(`❌ Error: ${CONFIG.LIGHTNESS_VALUES_FILE} not found`)
        console.error(`\nPlease run: npm run precompute`)
        process.exit(1)
    }
}

// ========== Data Loading Functions ==========

/**
 * Loads precomputed lightness values from JSON file
 * @returns Object mapping step numbers to lightness values
 */
function loadLightnessValues(): LightnessValues {
    console.log("Loading precomputed lightness values...")
    const lightnessValues: LightnessValues = JSON.parse(
        readFileSync(CONFIG.LIGHTNESS_VALUES_FILE, "utf-8")
    )
    console.log(
        `✓ Loaded ${Object.keys(lightnessValues).length} lightness values`
    )
    return lightnessValues
}

/**
 * Gets the total count of colors in the database
 * @param db - Database instance
 * @returns Total number of colors
 */
function getTotalColorCount(db: Database.Database): number {
    console.log("Counting colors in database...")
    const totalCount: number = (
        db.prepare(SQL_QUERIES.COUNT_COLORS).get() as DatabaseCountResult
    ).count
    console.log(`✓ Found ${totalCount.toLocaleString()} colors to load\n`)
    return totalCount
}

/**
 * Logs progress during color loading
 * @param loaded - Number of colors loaded so far
 * @param totalCount - Total number of colors to load
 * @param startTime - Timestamp when loading started
 */
function logLoadProgress(
    loaded: number,
    totalCount: number,
    startTime: number
): void {
    const elapsed: number = (Date.now() - startTime) / 1000
    const rate: number = loaded / elapsed
    const remaining: number = (totalCount - loaded) / rate
    const progress: string = ((loaded / totalCount) * 100).toFixed(1)

    console.log(
        `  Progress: ${loaded.toLocaleString()} / ${totalCount.toLocaleString()} (${progress}%) - ` +
            `${rate.toFixed(0)} colors/sec - ` +
            `ETA: ${remaining.toFixed(0)}s`
    )
}

/**
 * Loads all colors from database into memory grouped by lightness
 * @param db - Database instance
 * @param totalCount - Total number of colors to load
 * @returns Map of lightness values to arrays of colors
 */
function loadColorsIntoMemory(
    db: Database.Database,
    totalCount: number
): Map<number, Color[]> {
    console.log("Loading all colors into memory...")
    const colorsByLightness = new Map<number, Color[]>()

    const stmt = db.prepare(SQL_QUERIES.SELECT_ALL_COLORS)

    let loaded: number = 0
    const startTime: number = Date.now()

    for (const color of stmt.iterate() as IterableIterator<Color>) {
        const lightness: number = color.rounded_ok_l
        if (!colorsByLightness.has(lightness)) {
            colorsByLightness.set(lightness, [])
        }
        const colors = colorsByLightness.get(lightness)
        if (colors) {
            colors.push(color)
        }

        loaded++

        if (loaded % CONFIG.PROGRESS.LOAD_UPDATE_INTERVAL === 0) {
            logLoadProgress(loaded, totalCount, startTime)
        }
    }

    const loadTime: string = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`✓ Loaded ${loaded.toLocaleString()} colors in ${loadTime}s`)
    console.log(`✓ Grouped into ${colorsByLightness.size} lightness buckets`)

    return colorsByLightness
}

// ========== Color Utility Functions ==========

/**
 * Retrieves a random color with the specified lightness value from memory
 * @param colorsByLightness - Map of lightness values to color arrays
 * @param lightness - The target lightness value
 * @returns A random color with the specified lightness, or null if none available
 */
function getRandomColorWithLightness(
    colorsByLightness: Map<number, Color[]>,
    lightness: number
): Color | null {
    const colors = colorsByLightness.get(lightness)
    if (!colors || colors.length === 0) {
        return null
    }
    const randomIndex: number = Math.floor(Math.random() * colors.length)
    return colors[randomIndex]
}

/**
 * Converts an RGB color to a single numeric value for comparison
 * @param color - Color object with r, g, b values
 * @returns Numeric representation of the color
 */
function rgbToNumericValue(color: Color): number {
    return (
        color.r * CONFIG.RGB_MULTIPLIERS.RED +
        color.g * CONFIG.RGB_MULTIPLIERS.GREEN +
        color.b * CONFIG.RGB_MULTIPLIERS.BLUE
    )
}

/**
 * Creates a canonical key for a color pair
 * Ensures color1->color2 and color2->color1 produce the same key
 * @param color1 - First color
 * @param color2 - Second color
 * @returns Canonical string key for the color pair
 */
function createColorPairKey(color1: Color, color2: Color): string {
    const val1: number = rgbToNumericValue(color1)
    const val2: number = rgbToNumericValue(color2)

    const [first, second] = val1 <= val2 ? [color1, color2] : [color2, color1]
    return `${first.r},${first.g},${first.b}|${second.r},${second.g},${second.b}`
}

// ========== Display Functions ==========

/**
 * Displays sample color availability across lightness buckets
 * @param colorsByLightness - Map of lightness values to color arrays
 * @param lightnessValues - Object mapping step numbers to lightness values
 */
function displayColorAvailability(
    colorsByLightness: Map<number, Color[]>,
    lightnessValues: LightnessValues
): void {
    console.log("Sample color availability:")
    for (
        let i = CONFIG.LIGHTNESS.MIN_STEP;
        i <= CONFIG.LIGHTNESS.MAX_STEP;
        i += CONFIG.LIGHTNESS.SAMPLE_DISPLAY_INTERVAL
    ) {
        const lightness: number = lightnessValues[i]
        const colors = colorsByLightness.get(lightness)
        const count: number = colors ? colors.length : 0
        console.log(
            `Step ${i} (lightness ${lightness}): ${count.toLocaleString()} colors available`
        )
    }
}

/**
 * Reports a contrast failure with detailed information
 * @param totalTestsRun - Total number of tests run so far
 * @param distance - Current distance being tested
 * @param step1 - First step number
 * @param step2 - Second step number
 * @param lightness1 - Lightness value of first color
 * @param lightness2 - Lightness value of second color
 * @param color1 - First color
 * @param color2 - Second color
 * @param contrast - Calculated contrast ratio
 */
function reportContrastFailure(
    totalTestsRun: number,
    distance: number,
    step1: number,
    step2: number,
    lightness1: number,
    lightness2: number,
    color1: Color,
    color2: Color,
    contrast: number
): void {
    console.log(
        `\n❌ FAILURE FOUND after ${totalTestsRun.toLocaleString()} total tests!`
    )
    console.log(`─────────────────────────────────────────`)
    console.log(`Current distance: ${distance}`)
    console.log(`Step 1: ${step1} → Lightness: ${lightness1}`)
    console.log(`  Color: RGB(${color1.r}, ${color1.g}, ${color1.b})`)
    console.log(`  Y value: ${color1.y.toFixed(4)}`)
    console.log(`Step 2: ${step2} → Lightness: ${lightness2}`)
    console.log(`  Color: RGB(${color2.r}, ${color2.g}, ${color2.b})`)
    console.log(`  Y value: ${color2.y.toFixed(4)}`)
    console.log(
        `Contrast ratio: ${contrast.toFixed(3)}:1 (required: ${
            CONFIG.CONTRAST.MIN_RATIO
        }:1)`
    )
    console.log(`─────────────────────────────────────────`)
}

/**
 * Reports successful completion of all tests
 * @param distance - Final distance value
 * @param totalTestsRun - Total number of tests executed
 */
function reportSuccess(distance: number, totalTestsRun: number): void {
    console.log(`\n${"=".repeat(50)}`)
    console.log(`✅ SUCCESS!`)
    console.log(`${"=".repeat(50)}`)
    console.log(
        `All ${CONFIG.TEST.MAX_TESTS.toLocaleString()} tests passed with distance ${distance}`
    )
    console.log(`Total tests run: ${totalTestsRun.toLocaleString()}`)
    console.log(`Minimum safe distance: ${distance} steps`)
    console.log(
        `This ensures ${distance}/${CONFIG.LIGHTNESS.MAX_STEP} = ${(
            distance / 10
        ).toFixed(1)}% separation`
    )
    console.log(
        `guarantees at least ${CONFIG.CONTRAST.MIN_RATIO}:1 contrast ratio`
    )
}

// ========== Testing Functions ==========

/**
 * Creates a new bloom filter instance
 * @returns New BloomFilter instance
 */
function createBloomFilter(): BloomFilter {
    return BloomFilter.create(
        CONFIG.BLOOM_FILTER.EXPECTED_ITEMS,
        CONFIG.BLOOM_FILTER.FALSE_POSITIVE_RATE
    )
}

/**
 * Runs contrast tests on random color pairs
 * @param colorsByLightness - Map of lightness values to color arrays
 * @param lightnessValues - Object mapping step numbers to lightness values
 */
function runContrastTests(
    colorsByLightness: Map<number, Color[]>,
    lightnessValues: LightnessValues
): void {
    console.log("\n--- Starting Contrast Testing ---\n")

    const state: TestState = {
        distance: CONFIG.CONTRAST.INITIAL_DISTANCE,
        testCount: 0,
        totalTestsRun: 0,
        testedCombinations: createBloomFilter(),
    }

    console.log(
        `Bloom filter initialized for ${CONFIG.BLOOM_FILTER.EXPECTED_ITEMS.toLocaleString()} items with ${(
            CONFIG.BLOOM_FILTER.FALSE_POSITIVE_RATE * 100
        ).toFixed(1)}% false positive rate\n`
    )

    while (state.testCount < CONFIG.TEST.MAX_TESTS) {
        // Generate random step between 0 and (1000 - distance)
        const step1: number = Math.floor(
            Math.random() * (CONFIG.LIGHTNESS.MAX_STEP + 1 - state.distance)
        )
        const step2: number = step1 + state.distance

        // Get lightness values
        const lightness1: number = lightnessValues[step1]
        const lightness2: number = lightnessValues[step2]

        // Get random colors with these lightness values
        const color1: Color | null = getRandomColorWithLightness(
            colorsByLightness,
            lightness1
        )
        const color2: Color | null = getRandomColorWithLightness(
            colorsByLightness,
            lightness2
        )

        if (!color1 || !color2) {
            console.log(
                `Warning: No colors found for lightness ${lightness1} or ${lightness2}`
            )
            continue
        }

        // Create canonical key for this color pair
        const pairKey: string = createColorPairKey(color1, color2)

        // Skip if we've already tested this combination (bloom filter may have false positives)
        if (state.testedCombinations.has(pairKey)) {
            continue
        }

        // Mark this combination as tested
        state.testedCombinations.add(pairKey)

        // Calculate contrast using pre-computed Y (luminance) values
        const contrast: number = wcagContrast.luminance(color1.y, color2.y)

        state.testCount++
        state.totalTestsRun++

        if (contrast < CONFIG.CONTRAST.MIN_RATIO) {
            reportContrastFailure(
                state.totalTestsRun,
                state.distance,
                step1,
                step2,
                lightness1,
                lightness2,
                color1,
                color2,
                contrast
            )

            // Increase distance and reset counter
            state.distance++
            state.testCount = 0
            console.log(
                `\n→ Increasing distance to ${state.distance} and continuing...`
            )
            console.log(`   (Creating new bloom filter)\n`)
            // Create new bloom filter instance
            state.testedCombinations = createBloomFilter()
        }

        // Progress update
        if (state.testCount % CONFIG.PROGRESS.TEST_UPDATE_INTERVAL === 0) {
            console.log(
                `Distance ${
                    state.distance
                }: ${state.testCount.toLocaleString()} / ${CONFIG.TEST.MAX_TESTS.toLocaleString()} tests passed...`
            )
        }
    }

    reportSuccess(state.distance, state.totalTestsRun)
}

// ========== Main Function ==========

/**
 * Main function that orchestrates the contrast testing process
 */
function main(): void {
    // Get database path and validate files
    const dbPath: string = getDatabasePath()
    validateRequiredFiles(dbPath)

    // Load lightness values
    const lightnessValues: LightnessValues = loadLightnessValues()
    console.log(`Database: ${dbPath}\n`)

    // Open database
    const db = new Database(dbPath)

    // Get total count and load colors
    const totalCount: number = getTotalColorCount(db)
    const colorsByLightness: Map<number, Color[]> = loadColorsIntoMemory(
        db,
        totalCount
    )

    // Close database - we don't need it anymore
    db.close()

    // Display information and run tests
    console.log("\n=== Testing Color Contrast ===\n")
    displayColorAvailability(colorsByLightness, lightnessValues)
    runContrastTests(colorsByLightness, lightnessValues)
}

main()
