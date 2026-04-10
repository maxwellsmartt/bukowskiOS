import foundationCoreSql from "../migrations/0001_foundation.sql?raw";
import legacyRentmanSql from "../migrations/0002_legacy_rentman.sql?raw";
import adminFoundationSql from "../migrations/0003_admin_foundation.sql?raw";

const foundationMigrationSql = [foundationCoreSql, legacyRentmanSql, adminFoundationSql].join("\n\n");

export { foundationMigrationSql };
