import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = path.join(
  root,
  "poc-sherpa",
  "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"
);
const requiredFiles = [
  "encoder-epoch-99-avg-1.onnx",
  "decoder-epoch-99-avg-1.onnx",
  "joiner-epoch-99-avg-1.onnx",
  "tokens.txt",
];

function hasRequiredModelFiles() {
  return requiredFiles.every((file) => existsSync(path.join(modelPath, file)));
}

if (hasRequiredModelFiles()) {
  console.log(`[prepare:models] streaming model is ready: ${modelPath}`);
  process.exit(0);
}

const pythonCandidates = process.platform === "win32"
  ? [path.join(root, ".venv", "Scripts", "python.exe"), "python"]
  : [path.join(root, ".venv", "bin", "python3"), path.join(root, ".venv", "bin", "python"), "python3"];
const python = pythonCandidates.find((candidate) => candidate === "python" || candidate === "python3" || existsSync(candidate));

if (!python) {
  throw new Error("No Python executable found. Install Python 3.10-3.12 or create .venv before preparing models.");
}

console.log(`[prepare:models] streaming model is incomplete; downloading all models with ${python}`);
const result = spawnSync(python, [path.join(root, "download_all_models.py")], {
  cwd: root,
  stdio: "inherit",
});

if (result.error) {
  throw new Error(`Model preparation failed to start: ${result.error.message}`);
}
if (result.status !== 0) {
  throw new Error(`Model preparation failed with exit code ${result.status}`);
}
if (!hasRequiredModelFiles()) {
  throw new Error(`Model preparation completed without the required streaming model files: ${modelPath}`);
}

console.log(`[prepare:models] streaming model is ready: ${modelPath}`);
