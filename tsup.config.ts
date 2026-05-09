import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  noExternal: [/./],
  banner: {
    js: `import{createRequire as __cr}from"module";import{fileURLToPath as __f2p}from"url";var require=__cr(import.meta.url),__filename=__f2p(import.meta.url),__dirname=require("path").dirname(__filename);`,
  },
});
