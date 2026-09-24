import { readFileSync } from "node:fs";

export function openFile(filePath: string): Buffer {
  try {
    const buf = readFileSync(filePath);
    return buf;
  } catch (err) {
    if (err instanceof Error && "code" in err) {
      if (err.code === "ENOENT") {
        console.log("The file doesnt exist");
      }
    }
    throw err;
  }
}
