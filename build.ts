const stub = {
  name: "stub-devtools",
  setup(build: any) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default {}",
      loader: "js",
    }));
  },
};

const targets = [
  { target: "bun-darwin-arm64", outfile: "./dist/ilyich-cli-mac" },
  { target: "bun-windows-x64", outfile: "./dist/ilyich-cli-win" },
] as const;

for (const { target, outfile } of targets) {
  await Bun.build({
    entrypoints: ["./index.ts"],
    compile: { target, outfile },
    plugins: [stub],
  });
}
