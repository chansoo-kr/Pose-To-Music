// MediaPipe WASM 런타임과 Pose Landmarker 모델을 public/mediapipe 아래로 준비한다.
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "mediapipe");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");

const MODELS = {
  "pose_landmarker_lite.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
  "pose_landmarker_full.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
};

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(join(outDir, "wasm"), { recursive: true });
await mkdir(join(outDir, "models"), { recursive: true });

for (const file of await readdir(wasmSrc)) {
  await copyFile(join(wasmSrc, file), join(outDir, "wasm", file));
}

for (const [name, url] of Object.entries(MODELS)) {
  const dest = join(outDir, "models", name);
  if (await exists(dest)) continue;
  console.log(`downloading ${name} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
}

console.log("mediapipe assets ready");
