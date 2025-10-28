import Database from "better-sqlite3"

// ========== Type Definitions ==========

interface LightnessGroupResult {
    rounded_ok_l: number
    min_y: number
    max_y: number
    y_distance: number
    color_count: number
}

interface ColorResult {
    id: number
    r: number
    g: number
    b: number
    x: number
    y: number
    z: number
    ok_h: number
    ok_s: number
    ok_l: number
    rounded_ok_l: number
}

interface Statistics {
    totalGroups: number
    meanDistance: number
    medianDistance: number
    minDistance: number
    maxDistance: number
}

interface ExtremeColors {
    minYColor: ColorResult
    maxYColor: ColorResult
}

// ========== Constants ==========

const CONFIG = {
    DEFAULT_DB_PATH: "colors.db",
    DISPLAY_DECIMALS: 2,
    SEPARATOR_LENGTH: 80,
} as const

const TABLE_COLUMNS = [
    "Lightness",
    "Min Y",
    "Max Y",
    "Y Distance",
    "Color Count",
] as const

// ========== Database Query Functions ==========

/**
 * Retrieves lightness groups with Y value statistics from the database
 * @param db - Database instance
 * @returns Array of lightness group results with statistics
 */
function getLightnessGroups(db: Database.Database): LightnessGroupResult[] {
    const query = `
        SELECT
            rounded_ok_l,
            MIN(y) as min_y,
            MAX(y) as max_y,
            (MAX(y) - MIN(y)) as y_distance,
            COUNT(*) as color_count
        FROM colors
        GROUP BY rounded_ok_l
        ORDER BY rounded_ok_l ASC
    `
    return db.prepare<[], LightnessGroupResult>(query).all()
}

/**
 * Retrieves a color with the specified lightness value, ordered by Y
 * @param db - Database instance
 * @param roundedLightness - The rounded OKHSL lightness value
 * @param order - Sort order for Y value ("ASC" for minimum, "DESC" for maximum)
 * @returns Color result or undefined if not found
 */
function getColorByLightnessAndY(
    db: Database.Database,
    roundedLightness: number,
    order: "ASC" | "DESC"
): ColorResult | undefined {
    const query = `
        SELECT *
        FROM colors
        WHERE rounded_ok_l = ?
        ORDER BY y ${order}
        LIMIT 1
    `
    return db.prepare<[number], ColorResult>(query).get(roundedLightness)
}

/**
 * Retrieves the extreme colors (min and max Y) for a lightness group
 * @param db - Database instance
 * @param group - Lightness group result
 * @returns Object containing min and max Y colors
 */
function getExtremeColors(
    db: Database.Database,
    group: LightnessGroupResult
): ExtremeColors {
    const minYColor = getColorByLightnessAndY(db, group.rounded_ok_l, "ASC")
    const maxYColor = getColorByLightnessAndY(db, group.rounded_ok_l, "DESC")

    if (!minYColor || !maxYColor) {
        throw new Error(
            `Could not find extreme colors for lightness ${group.rounded_ok_l}`
        )
    }

    return { minYColor, maxYColor }
}

// ========== Statistical Functions ==========

/**
 * Calculates the arithmetic mean of an array of numbers
 * @param values - Array of numbers
 * @returns Mean value
 */
function calculateMean(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / values.length
}

/**
 * Calculates the median of an array of numbers
 * @param values - Array of numbers
 * @returns Median value
 */
function calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const length = sorted.length
    const middle = Math.floor(length / 2)

    return length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle]
}

/**
 * Calculates statistical measures for Y distances across all groups
 * @param groups - Array of lightness group results
 * @returns Statistics object with calculated measures
 */
function calculateStatistics(groups: LightnessGroupResult[]): Statistics {
    if (groups.length === 0) {
        throw new Error("Cannot calculate statistics for empty group list")
    }

    const distances = groups.map((group) => group.y_distance)

    return {
        totalGroups: distances.length,
        meanDistance: calculateMean(distances),
        medianDistance: calculateMedian(distances),
        minDistance: Math.min(...distances),
        maxDistance: Math.max(...distances),
    }
}

/**
 * Finds the lightness group with the maximum Y distance
 * @param groups - Array of lightness group results
 * @returns Group with the largest Y distance
 */
function findMaxDistanceGroup(
    groups: LightnessGroupResult[]
): LightnessGroupResult {
    if (groups.length === 0) {
        throw new Error("Cannot find max distance group in empty list")
    }

    return groups.reduce((max, group) =>
        group.y_distance > max.y_distance ? group : max
    )
}

// ========== Formatting Functions ==========

/**
 * Formats a number with a specified number of decimal places
 * @param value - Number to format
 * @param decimals - Number of decimal places (defaults to CONFIG.DISPLAY_DECIMALS)
 * @returns Formatted number string
 */
function formatNumber(
    value: number,
    decimals: number = CONFIG.DISPLAY_DECIMALS
): string {
    return value.toFixed(decimals)
}

/**
 * Formats an integer with locale-specific thousand separators
 * @param value - Number to format
 * @returns Formatted number string with separators
 */
function formatInteger(value: number): string {
    return value.toLocaleString()
}

/**
 * Creates a separator line of repeated characters
 * @param char - Character to repeat (defaults to "=")
 * @param length - Length of the separator (defaults to CONFIG.SEPARATOR_LENGTH)
 * @returns Separator string
 */
function getSeparator(
    char: string = "=",
    length: number = CONFIG.SEPARATOR_LENGTH
): string {
    return char.repeat(length)
}

// ========== Display Functions ==========

/**
 * Displays overall statistics about Y distances
 * @param stats - Statistics object with calculated measures
 */
function displayOverallStatistics(stats: Statistics): void {
    console.log("OVERALL STATISTICS:")
    console.log(getSeparator())
    console.log(`Total lightness groups: ${stats.totalGroups}`)
    console.log(`Mean Y distance: ${stats.meanDistance}`)
    console.log(`Median Y distance: ${stats.medianDistance}`)
    console.log(`Min Y distance: ${stats.minDistance}`)
    console.log(`Max Y distance: ${stats.maxDistance}`)
}

/**
 * Displays a table of all lightness groups with their Y statistics
 * @param groups - Array of lightness group results
 */
function displayGroupTable(groups: LightnessGroupResult[]): void {
    console.log("\n\nY DISTANCE FOR EACH LIGHTNESS GROUP:")
    console.log(getSeparator())

    const [col1, col2, col3, col4, col5] = TABLE_COLUMNS
    console.log(
        `${col1.padEnd(9)} | ${col2.padEnd(8)} | ${col3.padEnd(
            8
        )} | ${col4.padEnd(10)} | ${col5}`
    )
    console.log(getSeparator("-"))

    groups.forEach((group) => {
        const lightness = formatNumber(group.rounded_ok_l).padEnd(9)
        const minY = formatNumber(group.min_y).padEnd(8)
        const maxY = formatNumber(group.max_y).padEnd(8)
        const distance = formatNumber(group.y_distance).padEnd(10)
        const count = formatInteger(group.color_count)

        console.log(
            `${lightness} | ${minY} | ${maxY} | ${distance} | ${count}`
        )
    })
}

/**
 * Displays details about the lightness group with the largest Y distance
 * @param group - Lightness group result with maximum Y distance
 */
function displayMaxDistanceGroup(group: LightnessGroupResult): void {
    console.log("\n\nGROUP WITH LARGEST Y DISTANCE:")
    console.log(getSeparator())
    console.log(`Lightness: ${formatNumber(group.rounded_ok_l)}`)
    console.log(`Y Distance: ${group.y_distance}`)
    console.log(`Y Range: [${group.min_y}, ${group.max_y}]`)
    console.log(`Color Count: ${formatInteger(group.color_count)}`)
}

/**
 * Displays the extreme colors that create the largest Y distance
 * @param colors - Object containing min and max Y colors
 */
function displayExtremeColors(colors: ExtremeColors): void {
    console.log("\nColors creating the largest Y distance:")
    console.log(getSeparator("-"))

    console.log("\nColor with MINIMUM Y:")
    console.log(colors.minYColor)

    console.log("\nColor with MAXIMUM Y:")
    console.log(colors.maxYColor)
}

// ========== Main Function ==========

/**
 * Main function that analyzes Y distances for all lightness groups
 */
function main(): void {
    const dbPath = process.argv[2] ?? CONFIG.DEFAULT_DB_PATH

    console.log("Analyzing Y distance for all OKHSL lightness groups...\n")

    const db = new Database(dbPath)

    try {
        const groups = getLightnessGroups(db)

        if (groups.length === 0) {
            console.log("No lightness groups found in database.")
            return
        }

        const stats = calculateStatistics(groups)
        displayOverallStatistics(stats)
        displayGroupTable(groups)

        const maxDistanceGroup = findMaxDistanceGroup(groups)
        displayMaxDistanceGroup(maxDistanceGroup)

        const extremeColors = getExtremeColors(db, maxDistanceGroup)
        displayExtremeColors(extremeColors)
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "Unknown error"
        console.error(`❌ Error analyzing Y distances: ${errorMessage}`)
        throw error
    } finally {
        db.close()
    }
}

main()
