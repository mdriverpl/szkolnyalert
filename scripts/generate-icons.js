// Code-native raster version of public/icon.svg, without image dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
function chunk(type, bytes) { const label = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([label, bytes]))); return Buffer.concat([len, label, bytes, crc]); }
const shield = [[96,35],[145,54],[145,94],[140,117],[122,141],[96,159],[70,141],[52,117],[47,94],[47,54],[96,35]];
function distance(x,y,a,b) { const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy); }
for (const size of [180,192,512]) {
  const raw = Buffer.alloc((size*3+1)*size);
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const px=(x+.5)*192/size,py=(y+.5)*192/size;
    const stroke=shield.some((a,i)=>i<shield.length-1&&distance(px,py,a,shield[i+1])<4.5)||distance(px,py,[96,67],[96,102])<5||distance(px,py,[96,120],[96,124])<5;
    const color=stroke?[188,229,202]:[24,46,54];
    const offset=y*(size*3+1)+1+x*3;for(let c=0;c<3;c++)raw[offset+c]=color[c];
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  writeFileSync(`public/icon-${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
