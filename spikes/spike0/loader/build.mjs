// Builds the loader experiment into loader/dist/:
//   vendor/  one shared copy of React, ReactDOM and the React Refresh runtime, as ES modules
//   v1/, v2/ separately built applet versions, with react* marked external
// The loader page (public/) maps bare imports to vendor/ with an import map.

import { transformAsync } from "@babel/core";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const require = createRequire(import.meta.url);
rmSync(dist, { recursive: true, force: true });

// React ships CommonJS only. Generate ESM wrappers with explicit named exports
// (the way esm.sh does), and bundle them together so React exists once.
// Development builds: React Refresh needs them (production React has no hot-reload hooks).
process.env.NODE_ENV = "development";
const vendorSrc = join(here, ".vendor-src");
mkdirSync(vendorSrc, { recursive: true });
const vendors = {
  react: "react",
  "jsx-runtime": "react/jsx-runtime",
  "react-dom-client": "react-dom/client",
  "refresh-runtime": "react-refresh/runtime",
};
for (const [name, spec] of Object.entries(vendors)) {
  const keys = Object.keys(require(spec)).filter((k) => k !== "default" && /^[A-Za-z_$][\w$]*$/.test(k));
  writeFileSync(
    join(vendorSrc, `${name}.js`),
    `import m from ${JSON.stringify(spec)};\nexport default m;\nexport const { ${keys.join(", ")} } = m;\n`,
  );
}
await build({
  configFile: false,
  logLevel: "warn",
  mode: "development",
  define: { "process.env.NODE_ENV": '"development"' },
  build: {
    outDir: join(dist, "vendor"),
    minify: false,
    lib: {
      entry: Object.fromEntries(Object.keys(vendors).map((n) => [n, join(vendorSrc, `${n}.js`)])),
      formats: ["es"],
      fileName: (_, name) => `${name}.js`,
    },
  },
});

// Applet versions. A small plugin runs react-refresh/babel on each module and binds
// $RefreshReg$ to a globally supplied register function, with IDs of the form
// "<path relative to the version root> <component name>". The IDs are the same in
// every version, so the loader can treat v2's Counter as a new edition of v1's.
function refreshPlugin(root) {
  return {
    name: "react-refresh-registration",
    enforce: "pre",
    async transform(code, id) {
      if (!/\.[jt]sx$/.test(id)) return;
      const file = relative(root, id).replace(/\\/g, "/");
      const out = await transformAsync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        presets: [
          require.resolve("@babel/preset-typescript"),
          [require.resolve("@babel/preset-react"), { runtime: "automatic", development: false }],
        ],
        plugins: [[require.resolve("react-refresh/babel"), { skipEnvCheck: true }]],
      });
      const prelude =
        `const $RefreshReg$ = (type, id) => globalThis.__refreshReg(type, ${JSON.stringify(file)} + " " + id);\n` +
        "const $RefreshSig$ = () => globalThis.__refreshSig();\n";
      return { code: prelude + out.code, map: out.map };
    },
  };
}

for (const v of ["v1", "v2"]) {
  const root = join(here, "versions", v);
  await build({
    configFile: false,
    logLevel: "warn",
    mode: "development",
    plugins: [refreshPlugin(root)],
    oxc: false,
    build: {
      outDir: join(dist, v),
      minify: false,
      lib: { entry: join(root, "main.tsx"), formats: ["es"], fileName: () => "main.js" },
      rolldownOptions: { external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@harness/state"] },
    },
  });
}
console.log("built", dist);
