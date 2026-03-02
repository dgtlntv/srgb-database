import Database from "better-sqlite3"
import bloomPkg from "bloom-filters"
import { existsSync, readFileSync, writeFileSync } from "fs"
import wcagContrast from "wcag-contrast"

const { BloomFilter } = bloomPkg
type BloomFilterType = InstanceType<typeof BloomFilter>

// ========== Type Definitions ==========

interface Color {
    readonly r: number
    readonly g: number
    readonly b: number
    readonly y: number
    readonly ok_h: number
    readonly ok_s: number
    readonly ok_l: number
    readonly rounded_ok_l: number
}

interface DatabaseCountResult {
    count: number
}

interface LightnessValues {
    [key: number]: number
}

interface FailureRecord {
    distance: number
    testNumber: number
    step1: number
    step2: number
    color1: {
        r: number
        g: number
        b: number
        hue: number
        saturation: number
        lightness: number
        y: number
    }
    color2: {
        r: number
        g: number
        b: number
        hue: number
        saturation: number
        lightness: number
        y: number
    }
    contrastRatio: number
}

interface HueBucket {
    range: string
    count: number
    failureRate: number
}

interface SaturationBucket {
    range: string
    count: number
    failureRate: number
}

interface HueSaturationBucket {
    hueRange: string
    saturationRange: string
    count: number
}

interface AnalysisResult {
    totalTests: number
    totalFailures: number
    overallFailureRate: number
    distance: number
    hueAnalysis: HueBucket[]
    saturationAnalysis: SaturationBucket[]
    hueSaturationGrid: HueSaturationBucket[]
}

// ========== Constants ==========

const CONFIG = {
    DEFAULT_DB_PATH: "colors.db",
    LIGHTNESS_VALUES_FILE: "lightness-values.json",
    OUTPUT_FILES: {
        RAW_DATA: "failure-raw-data.json",
        ANALYSIS: "failure-analysis.json",
        CSV: "failure-data.csv",
    },
    RGB_MULTIPLIERS: {
        RED: 65536,
        GREEN: 256,
        BLUE: 1,
    },
    BLOOM_FILTER: {
        EXPECTED_ITEMS: 10_000_000,
        FALSE_POSITIVE_RATE: 0.001,
    },
    CONTRAST: {
        MIN_RATIO: 4.5,
        FIXED_DISTANCE: 520,
    },
    PROGRESS: {
        LOAD_UPDATE_INTERVAL: 500_000,
        TEST_UPDATE_INTERVAL: 50_000,
    },
    TEST: {
        MAX_TESTS: 1_000_000,
    },
    ANALYSIS: {
        HUE_BUCKET_SIZE: 30,
        SATURATION_BUCKET_SIZE: 0.1,
    },
    LIGHTNESS: {
        MAX_STEP: 1000,
    },
} as const

const SQL_QUERIES = {
    COUNT_COLORS: "SELECT COUNT(*) as count FROM colors",
    SELECT_ALL_COLORS:
        "SELECT r, g, b, y, ok_h, ok_s, ok_l, rounded_ok_l FROM colors",
} as const

// ========== Validation Functions ==========

function getDatabasePath(): string {
    return process.argv[2] ?? CONFIG.DEFAULT_DB_PATH
}

function validateRequiredFiles(dbPath: string): void {
    if (!existsSync(dbPath)) {
        console.error(`❌ Error: Database file not found at: ${dbPath}`)
        console.error(
            `\nUsage: node analyze-failing-colors.js [path/to/colors.db]`
        )
        console.error(`Example: node analyze-failing-colors.js ../colors.db`)
        process.exit(1)
    }

    if (!existsSync(CONFIG.LIGHTNESS_VALUES_FILE)) {
        console.error(`❌ Error: ${CONFIG.LIGHTNESS_VALUES_FILE} not found`)
        console.error(`\nPlease run: npm run precompute`)
        process.exit(1)
    }
}

// ========== Data Loading Functions ==========

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

function getTotalColorCount(db: Database.Database): number {
    console.log("Counting colors in database...")
    const totalCount: number = (
        db.prepare(SQL_QUERIES.COUNT_COLORS).get() as DatabaseCountResult
    ).count
    console.log(`✓ Found ${totalCount.toLocaleString()} colors to load\n`)
    return totalCount
}

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

function rgbToNumericValue(color: Color): number {
    return (
        color.r * CONFIG.RGB_MULTIPLIERS.RED +
        color.g * CONFIG.RGB_MULTIPLIERS.GREEN +
        color.b * CONFIG.RGB_MULTIPLIERS.BLUE
    )
}

function createColorPairKey(color1: Color, color2: Color): string {
    const val1: number = rgbToNumericValue(color1)
    const val2: number = rgbToNumericValue(color2)

    const [first, second] = val1 <= val2 ? [color1, color2] : [color2, color1]
    return `${first.r},${first.g},${first.b}|${second.r},${second.g},${second.b}`
}

// ========== Testing Functions ==========

function createBloomFilter(): BloomFilterType {
    return BloomFilter.create(
        CONFIG.BLOOM_FILTER.EXPECTED_ITEMS,
        CONFIG.BLOOM_FILTER.FALSE_POSITIVE_RATE
    )
}

function runFailureAnalysis(
    colorsByLightness: Map<number, Color[]>,
    lightnessValues: LightnessValues
): FailureRecord[] {
    console.log("\n--- Starting Failure Analysis ---\n")
    console.log(`Fixed distance: ${CONFIG.CONTRAST.FIXED_DISTANCE} steps`)
    console.log(
        `Total tests to run: ${CONFIG.TEST.MAX_TESTS.toLocaleString()}`
    )
    console.log(
        `Minimum contrast ratio required: ${CONFIG.CONTRAST.MIN_RATIO}:1\n`
    )

    const failures: FailureRecord[] = []
    const testedCombinations = createBloomFilter()

    console.log(
        `Bloom filter initialized for ${CONFIG.BLOOM_FILTER.EXPECTED_ITEMS.toLocaleString()} items with ${(
            CONFIG.BLOOM_FILTER.FALSE_POSITIVE_RATE * 100
        ).toFixed(1)}% false positive rate\n`
    )

    let testsRun = 0
    let attempts = 0
    const maxAttempts = CONFIG.TEST.MAX_TESTS * 10

    while (testsRun < CONFIG.TEST.MAX_TESTS && attempts < maxAttempts) {
        attempts++

        const step1: number = Math.floor(
            Math.random() *
                (CONFIG.LIGHTNESS.MAX_STEP +
                    1 -
                    CONFIG.CONTRAST.FIXED_DISTANCE)
        )
        const step2: number = step1 + CONFIG.CONTRAST.FIXED_DISTANCE

        const lightness1: number = lightnessValues[step1]
        const lightness2: number = lightnessValues[step2]

        const color1: Color | null = getRandomColorWithLightness(
            colorsByLightness,
            lightness1
        )
        const color2: Color | null = getRandomColorWithLightness(
            colorsByLightness,
            lightness2
        )

        if (!color1 || !color2) {
            continue
        }

        const pairKey: string = createColorPairKey(color1, color2)

        if (testedCombinations.has(pairKey)) {
            continue
        }

        testedCombinations.add(pairKey)

        const contrast: number = wcagContrast.luminance(color1.y, color2.y)

        testsRun++

        if (contrast < CONFIG.CONTRAST.MIN_RATIO) {
            failures.push({
                distance: CONFIG.CONTRAST.FIXED_DISTANCE,
                testNumber: testsRun,
                step1,
                step2,
                color1: {
                    r: color1.r,
                    g: color1.g,
                    b: color1.b,
                    hue: color1.ok_h,
                    saturation: color1.ok_s,
                    lightness: color1.ok_l,
                    y: color1.y,
                },
                color2: {
                    r: color2.r,
                    g: color2.g,
                    b: color2.b,
                    hue: color2.ok_h,
                    saturation: color2.ok_s,
                    lightness: color2.ok_l,
                    y: color2.y,
                },
                contrastRatio: contrast,
            })
        }

        if (testsRun % CONFIG.PROGRESS.TEST_UPDATE_INTERVAL === 0) {
            console.log(
                `Progress: ${testsRun.toLocaleString()} / ${CONFIG.TEST.MAX_TESTS.toLocaleString()} tests - ` +
                    `${failures.length} failures found (${(
                        (failures.length / testsRun) *
                        100
                    ).toFixed(2)}%)`
            )
        }
    }

    console.log(`\n✓ Completed ${testsRun.toLocaleString()} tests`)
    console.log(`✓ Found ${failures.length} failing color combinations`)
    console.log(
        `✓ Failure rate: ${((failures.length / testsRun) * 100).toFixed(2)}%\n`
    )

    return failures
}

// ========== Analysis Functions ==========

function analyzeFailures(
    failures: FailureRecord[],
    totalTests: number
): AnalysisResult {
    console.log("Analyzing failure patterns...\n")

    const hueMap = new Map<number, number>()
    const saturationMap = new Map<number, number>()
    const hueSaturationMap = new Map<string, number>()

    for (const failure of failures) {
        for (const color of [failure.color1, failure.color2]) {
            const hueBucket = Math.floor(
                color.hue / CONFIG.ANALYSIS.HUE_BUCKET_SIZE
            )
            const satBucket = Math.floor(
                color.saturation / CONFIG.ANALYSIS.SATURATION_BUCKET_SIZE
            )
            const hueSatKey = `${hueBucket}-${satBucket}`

            hueMap.set(hueBucket, (hueMap.get(hueBucket) || 0) + 1)
            saturationMap.set(
                satBucket,
                (saturationMap.get(satBucket) || 0) + 1
            )
            hueSaturationMap.set(
                hueSatKey,
                (hueSaturationMap.get(hueSatKey) || 0) + 1
            )
        }
    }

    const hueAnalysis: HueBucket[] = Array.from(hueMap.entries())
        .map(([bucket, count]) => ({
            range: `${bucket * CONFIG.ANALYSIS.HUE_BUCKET_SIZE}-${
                (bucket + 1) * CONFIG.ANALYSIS.HUE_BUCKET_SIZE
            }°`,
            count,
            failureRate: (count / (failures.length * 2)) * 100,
        }))
        .sort((a, b) => b.count - a.count)

    const saturationAnalysis: SaturationBucket[] = Array.from(
        saturationMap.entries()
    )
        .map(([bucket, count]) => ({
            range: `${(
                bucket * CONFIG.ANALYSIS.SATURATION_BUCKET_SIZE
            ).toFixed(1)}-${(
                (bucket + 1) *
                CONFIG.ANALYSIS.SATURATION_BUCKET_SIZE
            ).toFixed(1)}`,
            count,
            failureRate: (count / (failures.length * 2)) * 100,
        }))
        .sort((a, b) => b.count - a.count)

    const hueSaturationGrid: HueSaturationBucket[] = Array.from(
        hueSaturationMap.entries()
    )
        .map(([key, count]) => {
            const [hueBucket, satBucket] = key.split("-").map(Number)
            return {
                hueRange: `${hueBucket * CONFIG.ANALYSIS.HUE_BUCKET_SIZE}-${
                    (hueBucket + 1) * CONFIG.ANALYSIS.HUE_BUCKET_SIZE
                }°`,
                saturationRange: `${(
                    satBucket * CONFIG.ANALYSIS.SATURATION_BUCKET_SIZE
                ).toFixed(1)}-${(
                    (satBucket + 1) *
                    CONFIG.ANALYSIS.SATURATION_BUCKET_SIZE
                ).toFixed(1)}`,
                count,
            }
        })
        .sort((a, b) => b.count - a.count)

    return {
        totalTests,
        totalFailures: failures.length,
        overallFailureRate: (failures.length / totalTests) * 100,
        distance: CONFIG.CONTRAST.FIXED_DISTANCE,
        hueAnalysis,
        saturationAnalysis,
        hueSaturationGrid,
    }
}

// ========== Output Functions ==========

function saveRawData(failures: FailureRecord[]): void {
    console.log(
        `Saving raw failure data to ${CONFIG.OUTPUT_FILES.RAW_DATA}...`
    )
    writeFileSync(
        CONFIG.OUTPUT_FILES.RAW_DATA,
        JSON.stringify(failures, null, 2)
    )
    console.log(`✓ Saved ${failures.length} failure records`)
}

function saveAnalysis(analysis: AnalysisResult): void {
    console.log(`Saving analysis to ${CONFIG.OUTPUT_FILES.ANALYSIS}...`)
    writeFileSync(
        CONFIG.OUTPUT_FILES.ANALYSIS,
        JSON.stringify(analysis, null, 2)
    )
    console.log(`✓ Saved analysis results`)
}

function saveCSV(failures: FailureRecord[]): void {
    console.log(`Saving CSV data to ${CONFIG.OUTPUT_FILES.CSV}...`)

    const headers = [
        "Test Number",
        "Distance",
        "Step 1",
        "Step 2",
        "Color1 R",
        "Color1 G",
        "Color1 B",
        "Color1 Hue",
        "Color1 Saturation",
        "Color1 Lightness",
        "Color1 Y",
        "Color2 R",
        "Color2 G",
        "Color2 B",
        "Color2 Hue",
        "Color2 Saturation",
        "Color2 Lightness",
        "Color2 Y",
        "Contrast Ratio",
    ]

    const rows = failures.map((f) => [
        f.testNumber,
        f.distance,
        f.step1,
        f.step2,
        f.color1.r,
        f.color1.g,
        f.color1.b,
        f.color1.hue.toFixed(2),
        f.color1.saturation.toFixed(4),
        f.color1.lightness.toFixed(4),
        f.color1.y.toFixed(6),
        f.color2.r,
        f.color2.g,
        f.color2.b,
        f.color2.hue.toFixed(2),
        f.color2.saturation.toFixed(4),
        f.color2.lightness.toFixed(4),
        f.color2.y.toFixed(6),
        f.contrastRatio.toFixed(3),
    ])

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")

    writeFileSync(CONFIG.OUTPUT_FILES.CSV, csv)
    console.log(`✓ Saved CSV with ${failures.length} records`)
}

function displayAnalysisSummary(analysis: AnalysisResult): void {
    console.log("\n" + "=".repeat(60))
    console.log("ANALYSIS SUMMARY")
    console.log("=".repeat(60))
    console.log(`Total tests run: ${analysis.totalTests.toLocaleString()}`)
    console.log(`Total failures: ${analysis.totalFailures.toLocaleString()}`)
    console.log(
        `Overall failure rate: ${analysis.overallFailureRate.toFixed(2)}%`
    )
    console.log(`Distance tested: ${analysis.distance} steps\n`)

    console.log("Top 5 Problematic Hue Ranges:")
    console.log("-".repeat(60))
    analysis.hueAnalysis.slice(0, 5).forEach((bucket, i) => {
        console.log(
            `${i + 1}. ${bucket.range.padEnd(15)} - ${
                bucket.count
            } occurrences (${bucket.failureRate.toFixed(2)}%)`
        )
    })

    console.log("\nTop 5 Problematic Saturation Ranges:")
    console.log("-".repeat(60))
    analysis.saturationAnalysis.slice(0, 5).forEach((bucket, i) => {
        console.log(
            `${i + 1}. ${bucket.range.padEnd(15)} - ${
                bucket.count
            } occurrences (${bucket.failureRate.toFixed(2)}%)`
        )
    })

    console.log("\nTop 10 Problematic Hue + Saturation Combinations:")
    console.log("-".repeat(60))
    analysis.hueSaturationGrid.slice(0, 10).forEach((bucket, i) => {
        console.log(
            `${i + 1}. Hue: ${bucket.hueRange.padEnd(
                15
            )} Sat: ${bucket.saturationRange.padEnd(15)} - ${
                bucket.count
            } occurrences`
        )
    })
    console.log("=".repeat(60) + "\n")
}

// ========== Main Function ==========

function main(): void {
    const dbPath: string = getDatabasePath()
    validateRequiredFiles(dbPath)

    const lightnessValues: LightnessValues = loadLightnessValues()
    console.log(`Database: ${dbPath}\n`)

    const db = new Database(dbPath)

    const totalCount: number = getTotalColorCount(db)
    const colorsByLightness: Map<number, Color[]> = loadColorsIntoMemory(
        db,
        totalCount
    )

    db.close()

    console.log("\n=== Analyzing Failing Color Combinations ===\n")

    const failures = runFailureAnalysis(colorsByLightness, lightnessValues)

    if (failures.length > 0) {
        const analysis = analyzeFailures(failures, CONFIG.TEST.MAX_TESTS)

        console.log("\n--- Saving Results ---\n")
        saveRawData(failures)
        saveAnalysis(analysis)
        saveCSV(failures)

        displayAnalysisSummary(analysis)
    } else {
        console.log("\n✓ No failures found! All tested combinations passed.")
    }

    console.log("Analysis complete!")
}

main()
