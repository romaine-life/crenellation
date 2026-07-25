import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const usage = `Usage:
  node frontend/scripts/prepare-pixelover-project.mjs \\
    --template docs/art/pixelover/rook-v1/project/rook-v1.pixelover \\
    --image docs/art/pixelover/rook-v1/input/accepted-rook-style-ref-256.png \\
    --out docs/art/pixelover/rook-v1/project/rook-v1-generated.pixelover \\
    --export docs/art/pixelover/rook-v1/export/rook-south.png \\
    --name rook-south
`;

function readArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args.set(key, value);
    index += 1;
  }
  return args;
}

function requireArg(args, key) {
  const value = args.get(key);
  if (!value) throw new Error(`Missing --${key}\n\n${usage}`);
  return value;
}

function repoPath(value) {
  return path.resolve(process.cwd(), value);
}

function toPixelOverPath(value) {
  return value.replaceAll("\\", "/");
}

function replaceAscii(buffer, pattern, replacement) {
  const source = buffer.toString("binary");
  const next = source.replace(pattern, replacement);
  return Buffer.from(next, "binary");
}

function replaceLine(buffer, prefix, nextLine) {
  const source = buffer.toString("binary");
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`${escapedPrefix}[^\\n]*`);
  if (!expression.test(source)) {
    throw new Error(`Could not find line starting with ${prefix}`);
  }
  return Buffer.from(source.replace(expression, nextLine), "binary");
}

function replaceEmbeddedResource(template, imageBytes, imageName) {
  const source = template.toString("binary");
  const headerStart = source.indexOf("[resource_data key=");
  if (headerStart === -1) {
    throw new Error("Could not find PixelOver embedded resource header");
  }

  const lineFeed = source.indexOf("\n", headerStart);
  if (lineFeed === -1) {
    throw new Error("PixelOver embedded resource header has no line ending");
  }

  const dataStart = lineFeed + 1;
  const objectMarker = "\n[object id=0 type=\"canvas\"";
  const objectStart = source.indexOf(objectMarker, dataStart);
  if (objectStart === -1) {
    throw new Error("Could not find PixelOver canvas marker after embedded resource");
  }

  const before = template.subarray(0, headerStart);
  const after = template.subarray(objectStart);
  const header = Buffer.from(`[resource_data key="${imageName}" size=${imageBytes.length}]\n`, "utf8");
  return Buffer.concat([before, header, imageBytes, after]);
}

function main() {
  const args = readArgs(process.argv.slice(2));
  const templatePath = repoPath(requireArg(args, "template"));
  const imagePath = repoPath(requireArg(args, "image"));
  const outPath = repoPath(requireArg(args, "out"));
  const exportPath = repoPath(requireArg(args, "export"));
  const name = requireArg(args, "name");
  const imageName = path.basename(imagePath);

  const template = fs.readFileSync(templatePath);
  const imageBytes = fs.readFileSync(imagePath);

  let next = replaceEmbeddedResource(template, imageBytes, imageName);
  next = replaceLine(next, "location=", `location="${toPixelOverPath(outPath)}"`);
  next = replaceLine(next, "object_name=", `object_name="${name}"`);
  next = replaceLine(next, "path=", `path="${toPixelOverPath(imagePath)}"`);
  next = replaceAscii(next, /object_name="[^"]*"/g, `object_name="${name}"`);
  next = replaceLine(next, "export_path=", `export_path="${toPixelOverPath(exportPath)}"`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(exportPath), { recursive: true });
  fs.writeFileSync(outPath, next);

  console.log(JSON.stringify({
    out: outPath,
    image: imagePath,
    export: exportPath,
    bytes: next.length,
    embeddedImageBytes: imageBytes.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
