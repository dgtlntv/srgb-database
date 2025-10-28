import Database from "better-sqlite3"
import Color from "colorjs.io"
import { existsSync } from "fs"

// ========== Type Definitions ==========

type DatabaseInstance = ReturnType<typeof Database>

interface CountResult {
    count: number
}

interface ColorData {
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

type ColorTuple = [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number
]

// ========== Constants ==========

const CONFIG = {
    DEFAULT_DB_PATH: "colors.db",
    BATCH_SIZE: 10000,
    RGB_MAX: 256,
    RGB_NORMALIZE_DIVISOR: 255,
    LIGHTNESS_PRECISION: 100,
    LIGHTNESS_CAP_THRESHOLD: 0.995,
    NEAR_WHITE_LIGHTNESS: 0.99,
    PURE_WHITE_LIGHTNESS: 1.0,
} as const

// ========== Core Functions ==========

/**
 * Rounds lightness values with special handling for near-white and pure white colors
 * @param ok_l - The OKHSL lightness value to round
 * @returns Rounded lightness value
 */
function roundLightness(ok_l: number): number {
    if (ok_l >= CONFIG.LIGHTNESS_CAP_THRESHOLD && ok_l < CONFIG.PURE_WHITE_LIGHTNESS) {
        return CONFIG.NEAR_WHITE_LIGHTNESS
    }
    if (ok_l >= CONFIG.PURE_WHITE_LIGHTNESS) {
        return CONFIG.PURE_WHITE_LIGHTNESS
    }
    return Math.round(ok_l * CONFIG.LIGHTNESS_PRECISION) / CONFIG.LIGHTNESS_PRECISION
}

/**
 * Converts RGB values to color data including XYZ-D65 and OKHSL color spaces
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns Color data object with all color space values
 */
function convertRgbToColorData(r: number, g: number, b: number): ColorData {
    const color = new Color("srgb", [
        r / CONFIG.RGB_NORMALIZE_DIVISOR,
        g / CONFIG.RGB_NORMALIZE_DIVISOR,
        b / CONFIG.RGB_NORMALIZE_DIVISOR,
    ])

    const xyz = color.to("xyz-d65")
    const [x, y, z] = xyz.coords

    const okhsl = color.to("okhsl")
    const [ok_h, ok_s, ok_l] = okhsl.coords

    return {
        r,
        g,
        b,
        x: x ?? 0,
        y: y ?? 0,
        z: z ?? 0,
        ok_h: ok_h ?? 0,
        ok_s: ok_s ?? 0,
        ok_l: ok_l ?? 0,
        rounded_ok_l: roundLightness(ok_l ?? 0),
    }
}

/**
 * Converts color data object to tuple for database insertion
 * @param data - Color data object
 * @returns Array of values ready for database insertion
 */
function colorDataToTuple(data: ColorData): ColorTuple {
    return [
        data.r,
        data.g,
        data.b,
        data.x,
        data.y,
        data.z,
        data.ok_h,
        data.ok_s,
        data.ok_l,
        data.rounded_ok_l,
    ]
}

// ========== Database Functions ==========

/**
 * Creates the database schema for storing color data
 * @param db - Database instance
 */
function createDatabaseSchema(db: DatabaseInstance): void {
    db.exec(`
        CREATE TABLE colors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            r INTEGER NOT NULL,
            g INTEGER NOT NULL,
            b INTEGER NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            z REAL NOT NULL,
            ok_h REAL NOT NULL,
            ok_s REAL NOT NULL,
            ok_l REAL NOT NULL,
            rounded_ok_l REAL NOT NULL
        )
    `)

    console.log("✓ Table created")
}

/**
 * Creates database indexes for efficient querying
 * @param db - Database instance
 */
function createIndexes(db: DatabaseInstance): void {
    console.log("Creating indexes...")
    db.exec(`
        CREATE INDEX idx_rgb ON colors(r, g, b);
        CREATE INDEX idx_xyz ON colors(x, y, z);
        CREATE INDEX idx_okhsl ON colors(ok_h, ok_s, ok_l);
        CREATE INDEX idx_rounded_ok_l ON colors(rounded_ok_l);
    `)
    console.log("✓ Indexes created\n")
}

/**
 * Generates all possible sRGB colors and inserts them into the database
 * @param db - Database instance
 */
function generateColors(db: DatabaseInstance): void {
    const insert = db.prepare(`
        INSERT INTO colors (r, g, b, x, y, z, ok_h, ok_s, ok_l, rounded_ok_l)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((colors: ColorTuple[]): void => {
        for (const color of colors) {
            insert.run(color)
        }
    })

    console.log("Generating all sRGB colors...")

    let batch: ColorTuple[] = []
    let processed = 0

    for (let r = 0; r < CONFIG.RGB_MAX; r++) {
        for (let g = 0; g < CONFIG.RGB_MAX; g++) {
            for (let b = 0; b < CONFIG.RGB_MAX; b++) {
                const colorData = convertRgbToColorData(r, g, b)
                batch.push(colorDataToTuple(colorData))

                if (batch.length >= CONFIG.BATCH_SIZE) {
                    insertMany(batch)
                    processed += batch.length

                    console.log(
                        `Progress: ${processed.toLocaleString()} colors`
                    )
                    batch = []
                }
            }
        }
    }

    if (batch.length > 0) {
        insertMany(batch)
        processed += batch.length
    }
}

/**
 * Verifies database integrity by displaying statistics
 * @param db - Database instance
 */
function verifyDatabase(db: DatabaseInstance): void {
    console.log("\n=== Database Statistics ===")

    const totalColors = db
        .prepare<[], CountResult>("SELECT COUNT(*) as count FROM colors")
        .get()!.count
    console.log(`Total colors: ${totalColors.toLocaleString()}`)

    const distinctLightness = db
        .prepare<[], CountResult>(
            "SELECT COUNT(DISTINCT rounded_ok_l) as count FROM colors"
        )
        .get()!.count
    console.log(`Distinct lightness values: ${distinctLightness}`)
}

// ========== Validation Functions ==========

/**
 * Validates the database path and checks if database already exists
 * @param dbPath - Path to the database file
 * @returns True if database should be created, false if it already exists
 */
function validateDatabasePath(dbPath: string): boolean {
    if (existsSync(dbPath)) {
        console.log(`✓ Database already exists at: ${dbPath}`)
        console.log(`Skipping database creation.`)
        return false
    }
    return true
}

// ========== Main Function ==========

/**
 * Main function that orchestrates database creation
 */
function main(): void {
    const dbPath = process.argv[2] ?? CONFIG.DEFAULT_DB_PATH

    if (!validateDatabasePath(dbPath)) {
        return
    }

    console.log("=== Creating Color Database ===")
    console.log(`Database: ${dbPath}\n`)

    const db = new Database(dbPath)

    try {
        createDatabaseSchema(db)
        createIndexes(db)
        generateColors(db)
        verifyDatabase(db)

        console.log("\n✓ Database creation complete!")
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : "Unknown error"
        console.error(`❌ Error creating database: ${errorMessage}`)
        throw error
    } finally {
        db.close()
    }
}

main()
