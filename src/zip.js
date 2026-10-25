// Minimal dependency-free ZIP writer (STORE method), with UTF-8 filenames and CRC32.
// ZIP packaging itself doesn't recompress images, which are already compressed formats.
const encoder = new TextEncoder();
let crcTable;
function makeCrcTable() {const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);table[n]=c>>>0;}return table;}
function crc32(bytes){crcTable??=makeCrcTable();let crc=0xffffffff;for(let i=0;i<bytes.length;i++)crc=crcTable[(crc^bytes[i])&255]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function set16(view,offset,val){view.setUint16(offset,val,true)}
function set32(view,offset,val){view.setUint32(offset,val>>>0,true)}
function dosDate(date){const y=Math.max(1980,Math.min(date.getFullYear(),2107));return ((y-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()}
function dosTime(date){return(date.getHours()<<11)|(date.getMinutes()<<5)|Math.floor(date.getSeconds()/2)}
export async function createZip(files){
  if(files.length>1000)throw Error('Too many files');
  const chunks=[],central=[];let offset=0;let total=0;
  for(const {name,blob} of files){
    const nameBytes=encoder.encode(name);
    const data=new Uint8Array(await blob.arrayBuffer());total+=data.length;
    if(data.length>0xffffffff||total>0xffffffff||offset>0xffffffff||nameBytes.length>65535)throw Error('ZIP size limit exceeded');
    const crc=crc32(data);const now=new Date();const time=dosTime(now),date=dosDate(now);
    const local=new Uint8Array(30+nameBytes.length),v=new DataView(local.buffer);
    set32(v,0,0x04034b50);set16(v,4,20);set16(v,6,0x0800);set16(v,8,0);set16(v,10,time);set16(v,12,date);set32(v,14,crc);set32(v,18,data.length);set32(v,22,data.length);set16(v,26,nameBytes.length);set16(v,28,0);local.set(nameBytes,30);
    chunks.push(local,data);
    const dir=new Uint8Array(46+nameBytes.length),d=new DataView(dir.buffer);
    set32(d,0,0x02014b50);set16(d,4,20);set16(d,6,20);set16(d,8,0x0800);set16(d,10,0);set16(d,12,time);set16(d,14,date);set32(d,16,crc);set32(d,20,data.length);set32(d,24,data.length);set16(d,28,nameBytes.length);set16(d,30,0);set16(d,32,0);set16(d,34,0);set16(d,36,0);set32(d,38,0);set32(d,42,offset);dir.set(nameBytes,46);central.push(dir);
    offset+=local.length+data.length;
  }
  const centralSize=central.reduce((acc,part)=>acc+part.length,0);
  if(offset+centralSize>0xffffffff||files.length>65535)throw Error('ZIP format size limit exceeded');
  const footer=new Uint8Array(22),f=new DataView(footer.buffer);set32(f,0,0x06054b50);set16(f,4,0);set16(f,6,0);set16(f,8,files.length);set16(f,10,files.length);set32(f,12,centralSize);set32(f,16,offset);set16(f,20,0);
  return new Blob([...chunks,...central,footer],{type:'application/zip'});
}
