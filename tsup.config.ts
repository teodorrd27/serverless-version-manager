import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"], // Only build for CommonJS for Serverless
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
})