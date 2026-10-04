import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config.js";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: "@verixa/sessions",

      /**
       * The Redis integration spec starts a Testcontainers container, which
       * can take longer than vitest's default 5s hook timeout on a cold image
       * pull. The database-backed packages get away with the default because
       * CI hands them an already-running service; there is no Redis service
       * on every path this suite runs, so it may fall back to starting one.
       */
      hookTimeout: 120_000,

      coverage: {
        // Interface-only files have no executable statements to cover — a
        // TypeScript `interface` is erased entirely at compile time, so
        // there's nothing a test could ever exercise. Including them would
        // either drag the ratio down for no real signal or report a
        // meaningless 0% for a file with zero total statements.
        exclude: [
          "**/application/ports/**",
          "index.ts",
          // Database adapters are covered by their contract suite, which runs
          // only where a real Postgres is available. Counting them here would
          // mean the gate measures "was a database present" rather than "is
          // this code tested" — failing on a developer machine without Docker
          // while passing in CI, for the same commit.
          "**/infrastructure/persistence/**",
          "**/infrastructure/testing/database-harness.ts",
          // Benchmarks and operational scripts: run by hand, never imported
          // by anything that ships.
          "**/scripts/**",
        ],
        thresholds: {
          statements: 90,
          lines: 90,
          functions: 85,
          branches: 85,
        },
      },
    },
  }),
);
