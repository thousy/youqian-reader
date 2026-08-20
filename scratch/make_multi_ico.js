const fs = require('fs');
const path = require('path');

const sizes = [256, 128, 64, 48, 32, 16];
const scratchDir = path.join(__dirname);
const targetIcoPath1 = path.join(__dirname, '../build/icon.ico');
const targetIcoPath2 = path.join(__dirname, '../resources/icon.ico');

try {
  // Read all PNG files
  const pngs = sizes.map(size => {
    const filePath = path.join(scratchDir, `icon_${size}.png`);
    const buffer = fs.readFileSync(filePath);
    return { size, buffer };
  });

  // Calculate total header size: 6 bytes (global header) + 16 bytes * 6 (entries) = 102 bytes
  const headerSize = 6 + (16 * pngs.length);
  
  // Initialize Header buffer
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = Icon
  header.writeUInt16LE(pngs.length, 4); // Number of images

  // Initialize Entries buffer
  const entries = Buffer.alloc(16 * pngs.length);
  let currentOffset = headerSize;

  pngs.forEach((png, index) => {
    const entryOffset = index * 16;
    
    // Width & Height (0 means 256)
    const w = png.size >= 256 ? 0 : png.size;
    const h = png.size >= 256 ? 0 : png.size;
    
    entries.writeUInt8(w, entryOffset + 0);
    entries.writeUInt8(h, entryOffset + 1);
    entries.writeUInt8(0, entryOffset + 2); // Color count
    entries.writeUInt8(0, entryOffset + 3); // Reserved
    entries.writeUInt16LE(1, entryOffset + 4); // Planes
    entries.writeUInt16LE(32, entryOffset + 6); // Bits per pixel
    entries.writeUInt32LE(png.buffer.length, entryOffset + 8); // Size
    entries.writeUInt32LE(currentOffset, entryOffset + 12); // Offset
    
    currentOffset += png.buffer.length;
  });

  // Concatenate all parts
  const icoParts = [header, entries, ...pngs.map(p => p.buffer)];
  const icoBuffer = Buffer.concat(icoParts);

  // Write to both build/ and resources/ directories to be safe
  fs.writeFileSync(targetIcoPath1, icoBuffer);
  fs.writeFileSync(targetIcoPath2, icoBuffer);

  console.log(`Successfully generated multi-resolution ICO file (Size: ${icoBuffer.length} bytes)`);
  console.log(`Saved to ${targetIcoPath1}`);
  console.log(`Saved to ${targetIcoPath2}`);
} catch (err) {
  console.error('Failed to compile multi-resolution ICO:', err);
  process.exit(1);
}
