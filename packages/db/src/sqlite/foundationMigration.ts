import foundationCoreSql from "../migrations/0001_foundation.sql?raw";
import legacyRentmanSql from "../migrations/0002_legacy_rentman.sql?raw";

const foundationMigrationSql = [foundationCoreSql, legacyRentmanSql].join("\n\n");

export { foundationMigrationSql };
