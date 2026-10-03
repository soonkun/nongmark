// esbuild로 편집기 묶음을 만든다 → ../../build/editor-bundle.js, editor-bundle.css (build.py가 nongmark.html에 넣는다)
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, "src/main.js")],
  bundle: true, minify: true, format: "iife", target: ["chrome110"], platform: "browser",
  outfile: path.join(here, "../../build/editor-bundle.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none", logLevel: "info",
});
