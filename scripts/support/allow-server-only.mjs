// For CLI scripts and tests: lets service modules that `import "server-only"`
// load under plain Node. The real guard still applies inside Next.js builds.
import { registerHooks } from "node:module";

const empty = new URL("./empty.cjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: empty, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
