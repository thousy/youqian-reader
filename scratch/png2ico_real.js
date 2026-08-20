const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '../resources/icon_256.png');
const icoPath = path.join(__dirname, '../resources/icon.ico');

try {
  const pngBuffer = fs.readFileSync(pngPath);
  
  // Parse PNG header to get width and height
  // PNG signature is 8 bytes, IHDR chunk length is 4 bytes, IHDR chunk type is 4 bytes.
  // Width is at offset 16 (4 bytes), Height is at offset 20 (4 bytes).
  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);
  console.log(`Detected PNG dimensions: ${width}x${height}`);

  // Create ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = Icon
  header.writeUInt16LE(1, 4); // Number of images: 1

  // Create Directory Entry (16 bytes)
  const entry = Buffer.alloc(16);
  // Width and height in ICO: 1-255, or 0 if >= 256
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2); // Color palette count (0 for no palette)
  entry.writeUInt8(0, 3); // Reserved
  entry.writeUInt16LE(1, 4); // Color planes (1)
  entry.writeUInt16LE(32, 6); // Bits per pixel (32)
  entry.writeUInt32LE(pngBuffer.length, 8); // Image size (PNG size)
  entry.writeUInt32LE(22, 12); // Image offset (header 6 bytes + entry 16 bytes = 22)

  // Combine header, entry, and PNG data
  const icoBuffer = Buffer.concat([header, entry, pngBuffer]);
  
  fs.writeFileSync(icoPath, icoBuffer);
  console.log(`Successfully generated valid ICO file at: ${icoPath} (Size: ${icoBuffer.length} bytes)`);
} catch (err) {
  console.error('Failed to convert PNG to ICO:', err);
  process.exit(1);
}
