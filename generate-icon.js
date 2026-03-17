// generate-icon.js — Generates a Windows .ico file with 256x256, 48x48, 32x32 and 16x16 icons
// Orange circle (#D97734) with white "C" letter, using only Node.js built-in modules.

const fs = require('fs');
const path = require('path');

// Claude brand orange
const R = 0xD9, G = 0x77, B = 0x34;

function renderIcon(size) {
  // Returns RGBA buffer (top-to-bottom row order) for the icon at given size
  const buf = Buffer.alloc(size * size * 4);
  const half = size / 2;
  const radius = half - 1.5; // circle radius in pixels

  // Font metrics scaled to icon size
  const cOuterR = radius * 0.68;
  const cInnerR = radius * 0.34;
  const cGapAngle = 0.9; // radians, opening on the right side of the C

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = x - half + 0.5;
      const cy = y - half + 0.5;
      const dist = Math.sqrt(cx * cx + cy * cy);

      if (dist <= radius + 0.5) {
        // Inside the circle (with anti-aliased edge)
        const alpha = Math.min(1, radius + 0.5 - dist);

        // Check if this pixel is part of the "C" letter
        const angle = Math.atan2(cy, cx); // -PI to PI, 0 = right
        const isInRing = dist >= cInnerR && dist <= cOuterR;
        // The gap of the C is on the right side (angle near 0)
        const isInGap = angle > -cGapAngle && angle < cGapAngle;
        const isC = isInRing && !isInGap;

        if (isC) {
          // White letter
          buf[idx]     = 255;
          buf[idx + 1] = 255;
          buf[idx + 2] = 255;
        } else {
          // Orange background
          buf[idx]     = R;
          buf[idx + 1] = G;
          buf[idx + 2] = B;
        }
        buf[idx + 3] = Math.round(255 * alpha);
      } else {
        // Transparent
        buf[idx + 3] = 0;
      }
    }
  }
  return buf;
}

function createBmpData(size, rgbaBuf) {
  // ICO stores BMPs in a special way:
  //  - BITMAPINFOHEADER (40 bytes) with height = size*2 (image + mask)
  //  - Pixel data is bottom-to-top, BGRA
  //  - AND mask follows (1-bit per pixel, bottom-to-top, rows padded to 4 bytes)

  const headerSize = 40;
  const pixelDataSize = size * size * 4;
  const maskRowBytes = Math.ceil(size / 8);
  const maskRowPadded = (maskRowBytes + 3) & ~3; // pad to 4 bytes
  const maskSize = maskRowPadded * size;

  const totalSize = headerSize + pixelDataSize + maskSize;
  const bmp = Buffer.alloc(totalSize);

  // BITMAPINFOHEADER
  bmp.writeUInt32LE(40, 0);           // biSize
  bmp.writeInt32LE(size, 4);          // biWidth
  bmp.writeInt32LE(size * 2, 8);      // biHeight (double for ICO: image + mask)
  bmp.writeUInt16LE(1, 12);           // biPlanes
  bmp.writeUInt16LE(32, 14);          // biBitCount (32-bit BGRA)
  bmp.writeUInt32LE(0, 16);           // biCompression
  bmp.writeUInt32LE(pixelDataSize + maskSize, 20); // biSizeImage
  // Rest of header fields are 0

  // Write pixel data (bottom-to-top, BGRA)
  let offset = headerSize;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const srcIdx = (y * size + x) * 4;
      bmp[offset]     = rgbaBuf[srcIdx + 2]; // B
      bmp[offset + 1] = rgbaBuf[srcIdx + 1]; // G
      bmp[offset + 2] = rgbaBuf[srcIdx];     // R
      bmp[offset + 3] = rgbaBuf[srcIdx + 3]; // A
      offset += 4;
    }
  }

  // Write AND mask (bottom-to-top). 1 = transparent, 0 = opaque.
  for (let y = size - 1; y >= 0; y--) {
    for (let byteX = 0; byteX < maskRowPadded; byteX++) {
      let maskByte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = byteX * 8 + bit;
        if (px < size) {
          const srcIdx = (y * size + px) * 4;
          const alpha = rgbaBuf[srcIdx + 3];
          if (alpha < 128) {
            maskByte |= (0x80 >> bit); // transparent
          }
        }
      }
      bmp[offset++] = maskByte;
    }
  }

  return bmp;
}

function buildIco(images) {
  // images: array of { size, bmpData }
  const numImages = images.length;

  // ICO header: 6 bytes
  // Directory entries: 16 bytes each
  // Then BMP data for each image
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;

  let dataOffset = headerSize + dirSize;
  const parts = [];

  // Header
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // type: 1 = ICO
  header.writeUInt16LE(numImages, 4);  // number of images
  parts.push(header);

  // Directory entries
  const bmpBuffers = [];
  for (const img of images) {
    const entry = Buffer.alloc(dirEntrySize);
    entry[0] = img.size < 256 ? img.size : 0; // width (0 means 256)
    entry[1] = img.size < 256 ? img.size : 0; // height
    entry[2] = 0;  // color palette count
    entry[3] = 0;  // reserved
    entry.writeUInt16LE(1, 4);   // color planes
    entry.writeUInt16LE(32, 6);  // bits per pixel
    entry.writeUInt32LE(img.bmpData.length, 8);  // data size
    entry.writeUInt32LE(dataOffset, 12);          // data offset
    parts.push(entry);
    dataOffset += img.bmpData.length;
    bmpBuffers.push(img.bmpData);
  }

  // BMP data
  for (const bmpBuf of bmpBuffers) {
    parts.push(bmpBuf);
  }

  return Buffer.concat(parts);
}

// Generate all sizes (256 required for Windows installer/taskbar)
const sizes = [256, 48, 32, 16];
const images = sizes.map(size => {
  const rgba = renderIcon(size);
  const bmpData = createBmpData(size, rgba);
  return { size, bmpData };
});

const ico = buildIco(images);
const outPath = path.join(__dirname, 'icon.ico');
fs.writeFileSync(outPath, ico);
console.log(`Icon written to ${outPath} (${ico.length} bytes, ${sizes.join('x')} + ${sizes.join('x')} sizes)`);
