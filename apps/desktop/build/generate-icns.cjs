const fs = require("node:fs");
const path = require("node:path");

const entries = [
  ["icp4", "icon_16x16.png"],
  ["icp5", "icon_32x32.png"],
  ["icp6", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic08", "icon_256x256.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
  ["ic11", "icon_16x16@2x.png"],
  ["ic12", "icon_32x32@2x.png"],
  ["ic13", "icon_128x128@2x.png"],
  ["ic14", "icon_256x256@2x.png"],
];

const [, , iconsetPath, outputPath] = process.argv;

if (!iconsetPath || !outputPath) {
  console.error("Usage: node generate-icns.cjs <iconset-dir> <output.icns>");
  process.exit(1);
}

const chunks = entries
  .map(([type, filename]) => {
    const filePath = path.join(iconsetPath, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing iconset file: ${filename}`);
    }

    const png = fs.readFileSync(filePath);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });

const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 8);
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(totalSize, 4);

fs.writeFileSync(outputPath, Buffer.concat([header, ...chunks]));
