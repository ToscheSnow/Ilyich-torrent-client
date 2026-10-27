const stub = {
  name: "stub-devtools",
  setup(build: any) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "stub",
    }));

    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default {};",
      loader: "js",
    }));
  },
};

const targets = [
  { target: "bun-darwin-arm64", outfile: "./dist/ilyich-mac" },
  { target: "bun-windows-x64", outfile: "./dist/ilyich-win-x64" },
  { target: "bun-linux-x64", outfile: "./dist/ilyich-cli-linux-x64" },
] as const;

for (const { target, outfile } of targets) {
  const result = await Bun.build({
    entrypoints: ["./index.ts"],
    compile: { target, outfile },
    plugins: [stub],
  });

  if (!result.success) {
    console.error(`Build failed for ${target}:`);
    console.error(result.logs);
    process.exitCode = 1;
    break;
  }
}
