// MoConvert metadata bridge v1.1: EXIF/XMP block transfer for JPEG, PNG, WebP.
// On purpose, ICC is NOT blindly copied across browser canvas conversions:
// the decoded canvas is rendered in sRGB, so a source ICC could mislabel the output.
const TE = new TextEncoder();
const TD = new TextDecoder();
const ASCII = value => TE.encode(value);
const is = (bytes, offset, text) => offset >= 0 && offset + text.length <= bytes.length && [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
const match = (bytes, off, prefix) => bytes.length >= off + prefix.length && prefix.every((b, i) => bytes[off + i] === b);
const u16be = (a, i) => (a[i] << 8) | a[i+1];
const u32be = (a, i) => ((a[i] * 0x1000000) + ((a[i+1]<<16) | (a[i+2]<<8) | a[i+3])) >>> 0;
const u32le = (a, i) => (a[i] | (a[i+1]<<8) | (a[i+2]<<16) | (a[i+3]<<24)) >>> 0;
const write32le = (a,i,v) => {a[i]=v&255;a[i+1]=(v>>>8)&255;a[i+2]=(v>>>16)&255;a[i+3]=(v>>>24)&255;};
const concat = parts => {const size=parts.reduce((sum,b)=>sum+b.length,0);const all=new Uint8Array(size);let n=0;for(const b of parts){all.set(b,n);n+=b.length}return all;};
const jpegExifPrefix=ASCII('Exif\0\0');
const jpegXmpPrefix=ASCII('http://ns.adobe.com/xap/1.0/\0');
const iccPrefix=ASCII('ICC_PROFILE\0');
const pngSig=new Uint8Array([137,80,78,71,13,10,26,10]);
const looksTiff=b => b?.length>=8 && ((is(b,0,'II') && b[2]===42 && b[3]===0) || (is(b,0,'MM') && b[2]===0 && b[3]===42));
const detect = bytes => is(bytes,0,'\xFF\xD8') ? 'jpeg' : match(bytes,0,pngSig) ? 'png' : (is(bytes,0,'RIFF')&&is(bytes,8,'WEBP')?'webp':null);
// Detailed inventory: counts blocks, including unsupported ICC, to avoid fake "Preserved" labels.
export function readMetadataBytes(bytes){
  const format=detect(bytes);const out={format,exif:null,xmp:null,icc:false,other:false};
  if(format==='jpeg'){
    for(let p=2;p+4<=bytes.length;){if(bytes[p]!==0xff)break;while(bytes[p]===0xff)p++;const marker=bytes[p++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(p+2>bytes.length)break;const size=u16be(bytes,p);if(size<2||p+size>bytes.length)break;const from=p+2,to=p+size;const value=bytes.subarray(from,to);
      if(marker===0xe1&&match(value,0,jpegExifPrefix)){if(!out.exif)out.exif=value.slice(6)}
      else if(marker===0xe1&&match(value,0,jpegXmpPrefix)){if(!out.xmp)out.xmp=value.slice(jpegXmpPrefix.length)}
      else if(marker===0xe2&&match(value,0,iccPrefix))out.icc=true;
      else if(marker===0xe1 || marker===0xed)out.other=true;
      p=to;
    }
  }else if(format==='png'){
    for(let p=8;p+12<=bytes.length;){const length=u32be(bytes,p);if(length>bytes.length-p-12)break;const name=TD.decode(bytes.subarray(p+4,p+8));const body=bytes.subarray(p+8,p+8+length);
      if(name==='eXIf'){if(!out.exif)out.exif=body.slice()}
      else if(name==='iTXt'&&is(body,0,'XML:com.adobe.xmp\0')){const start='XML:com.adobe.xmp'.length+1;if(body[start]===0&&body[start+1]===0&&body[start+2]===0&&body[start+3]===0){if(!out.xmp)out.xmp=body.slice(start+4)}else out.other=true;}
      else if(name==='iCCP')out.icc=true;
      else if(['tEXt','zTXt','tIME'].includes(name))out.other=true;
      p+=12+length;if(name==='IEND')break;
    }
  }else if(format==='webp'){
    for(let p=12;p+8<=bytes.length;){const length=u32le(bytes,p+4);if(length>bytes.length-p-8)break;const name=TD.decode(bytes.subarray(p,p+4));const body=bytes.subarray(p+8,p+8+length);
      if(name==='EXIF'){if(!out.exif)out.exif=(match(body,0,jpegExifPrefix)?body.slice(6):body.slice())}
      else if(name==='XMP '){if(!out.xmp)out.xmp=body.slice()}
      else if(name==='ICCP')out.icc=true;
      p+=8+length+(length&1);
    }
  }
  return out;
}
// Avoid applying the source orientation a second time to pixels already oriented by canvas.
// Update both IFD0 image geometry and EXIF PixelX/YDimension after resize, where scalar.
function patchExif(exif,width,height){
  if(!looksTiff(exif))return null;
  const bytes=exif.slice();const little=bytes[0]===73;const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const r16=o=>d.getUint16(o,little),r32=o=>d.getUint32(o,little),w16=(o,v)=>d.setUint16(o,v,little),w32=(o,v)=>d.setUint32(o,v,little);
  const visited=new Set();
  function fixIfd(ptr,depth){if(depth>3||ptr===0)return;if(ptr<8||ptr+2>bytes.length||visited.has(ptr))throw Error('badEXIF');visited.add(ptr);
    const count=r16(ptr);if(count>1000||ptr+2+12*count+4>bytes.length)throw Error('badEXIF');
    for(let i=0;i<count;i++){const e=ptr+2+12*i,tag=r16(e),type=r16(e+2),qty=r32(e+4);const same=qty===1 && (type===3||type===4);
      const write=v=>{if(!same)return false;if(type===3){if(v>65535)return false;w16(e+8,v)}else w32(e+8,v);return true};
      if(tag===0x0112 && !write(1))throw Error('badOrientation');
      if(tag===0x0100 && !write(width))throw Error('badDimensions');
      if(tag===0x0101 && !write(height))throw Error('badDimensions');
      if(tag===0xa002 && !write(width))throw Error('badDimensions');
      if(tag===0xa003 && !write(height))throw Error('badDimensions');
      if((tag===0x8769||tag===0x8825||tag===0xa005)&&type===4&&qty===1){const child=r32(e+8);if(child)fixIfd(child,depth+1)}
    }
    // Remove stale embedded thumbnail reference; do not expose old image previews.
    w32(ptr+2+12*count,0);
  }
  try{fixIfd(r32(4),0);return bytes}catch{return null}
}
function patchXmp(xmp,width,height){
  if(!xmp?.length)return null;
  // XMP may contain layout, orientation and GPS. Preserve GPS only with opt-in.
  // Do not copy potentially stale image geometry across a resize; EXIF still preserved.
  const decoded=TD.decode(xmp);
  if(!decoded.includes('<'))return null;
  let text=decoded;
  text=text.replace(/(tiff:Orientation\s*=\s*["'])\d+(["'])/g,(_,before,after)=>before+'1'+after);
  text=text.replace(/(<tiff:Orientation>)(\d+)(<\/tiff:Orientation>)/g,(_,a,_b,c)=>a+'1'+c);
  if(!Number.isInteger(width)||!Number.isInteger(height))return null;
  // If XMP has dimensions we cannot reliably rewrite every namespace variation.
  if(/(?:tiff:(?:ImageWidth|ImageLength)|exif:(?:PixelXDimension|PixelYDimension))/.test(text))return null;
  return ASCII(text);
}
function appSegment(marker,payload){if(payload.length>65533)return null;return concat([new Uint8Array([255,marker,(payload.length+2)>>>8,(payload.length+2)&255]),payload]);}
let crcTable;function crc32(bytes){if(!crcTable){crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0}}
  let c=0xffffffff;for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0;
}
function pngChunk(type,data){const name=ASCII(type);const bytes=new Uint8Array(12+data.length);const n=data.length;bytes[0]=n>>>24;bytes[1]=n>>>16;bytes[2]=n>>>8;bytes[3]=n;bytes.set(name,4);bytes.set(data,8);const c=crc32(bytes.subarray(4,8+n));bytes[8+n]=c>>>24;bytes[9+n]=c>>>16;bytes[10+n]=c>>>8;bytes[11+n]=c;return bytes;}
function webpChunk(type,data){const bytes=new Uint8Array(8+data.length+(data.length&1));bytes.set(ASCII(type),0);write32le(bytes,4,data.length);bytes.set(data,8);return bytes;}
function embedJpeg(bytes,exif,xmp){if(detect(bytes)!=='jpeg')throw Error('invalidOutput');const chunks=[bytes.subarray(0,2)];let p=2;while(p+4<=bytes.length){if(bytes[p]!==255)break;const marker=bytes[p+1];if(marker!==0xe0&&marker!==0xe1&&marker!==0xe2&&marker!==0xed)break;const size=u16be(bytes,p+2);if(size<2||p+2+size>bytes.length)break;chunks.push(bytes.subarray(p,p+2+size));p+=2+size;}
 const inserted=[];if(exif){const seg=appSegment(0xe1,concat([jpegExifPrefix,exif]));if(seg)inserted.push(seg)}
 if(xmp){const seg=appSegment(0xe1,concat([jpegXmpPrefix,xmp]));if(seg)inserted.push(seg)}
 return concat([...chunks,...inserted,bytes.subarray(p)]);
}
function embedPng(bytes,exif,xmp){if(detect(bytes)!=='png')throw Error('invalidOutput');if(bytes.length<33||!is(bytes,12,'IHDR'))throw Error('invalidOutput');const iend=8+12+u32be(bytes,8);if(iend>bytes.length)throw Error('invalidOutput');const parts=[bytes.subarray(0,iend)];if(exif)parts.push(pngChunk('eXIf',exif));
 if(xmp)parts.push(pngChunk('iTXt',concat([ASCII('XML:com.adobe.xmp'),new Uint8Array([0,0,0,0,0]),xmp])));
 parts.push(bytes.subarray(iend));return concat(parts);
}
function embedWebp(bytes,exif,xmp,width,height){if(detect(bytes)!=='webp')throw Error('invalidOutput');if(width<1||height<1||width>16384||height>16384)throw Error('invalidOutput');const chunks=[];let p=12;let hasVp8x=false;let hasAlpha=false;
 while(p+8<=bytes.length){const size=u32le(bytes,p+4);const end=p+8+size+(size&1);if(end>bytes.length)throw Error('invalidOutput');const type=TD.decode(bytes.subarray(p,p+4));const segment=bytes.slice(p,end);
  if(type==='VP8X'){hasVp8x=true;segment[8]=(segment[8]&~(0x08|0x04))|(exif?0x08:0)|(xmp?0x04:0);hasAlpha=Boolean(segment[8]&0x10)}
  if(type==='ALPH')hasAlpha=true;
  if(type==='VP8L'&&size>=5){const data=bytes.subarray(p+8,p+8+size);hasAlpha=hasAlpha||Boolean(data[4]&0x10)}
  if(type!=='EXIF'&&type!=='XMP ')chunks.push({type,bytes:segment});p=end;
 }
 if(p!==bytes.length)throw Error('invalidOutput');
 if(!hasVp8x){const flags=(hasAlpha?0x10:0)|(exif?0x08:0)|(xmp?0x04:0);const header=new Uint8Array(10);header[0]=flags;const w=width-1,h=height-1;header[4]=w&255;header[5]=w>>>8;header[6]=w>>>16;header[7]=h&255;header[8]=h>>>8;header[9]=h>>>16;chunks.unshift({type:'VP8X',bytes:webpChunk('VP8X',header)});}
 const idx=chunks.findIndex(item=>item.type==='VP8X');if(idx>0){const [vp8x]=chunks.splice(idx,1);chunks.unshift(vp8x)}
 if(exif)chunks.push({type:'EXIF',bytes:webpChunk('EXIF',exif)});
 if(xmp)chunks.push({type:'XMP ',bytes:webpChunk('XMP ',xmp)});
 const body=concat(chunks.map(c=>c.bytes));const out=new Uint8Array(12+body.length);out.set(ASCII('RIFF'));write32le(out,4,body.length+4);out.set(ASCII('WEBP'),8);out.set(body,12);return out;
}
const hasContent=meta=>Boolean(meta.exif||meta.xmp||meta.icc||meta.other);
export async function preserveImageMetadata(sourceFile,resultBlob,mime,width,height){
  const source=readMetadataBytes(new Uint8Array(await sourceFile.arrayBuffer()));
  if(!source.format)return {blob:resultBlob,metadata:{state:'unsupported',detail:'metadataUnsupportedSource'}};
  if(!hasContent(source))return {blob:resultBlob,metadata:{state:'none',detail:'metadataNone'}};
  const outMime={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[mime];
  if(!outMime)return {blob:resultBlob,metadata:{state:'unsupported',detail:'metadataUnsupportedOutput'}};
  const exif=source.exif?patchExif(source.exif,width,height):null;
  const xmp=source.xmp?patchXmp(source.xmp,width,height):null;
  let blob=resultBlob,actuallyExif=false,actuallyXmp=false;
  if(exif||xmp){
    try{const original=new Uint8Array(await resultBlob.arrayBuffer());const encoded=outMime==='jpeg'?embedJpeg(original,exif,xmp):outMime==='png'?embedPng(original,exif,xmp):embedWebp(original,exif,xmp,width,height);
      const recheck=readMetadataBytes(encoded);actuallyExif=Boolean(exif&&recheck.exif?.length&&recheck.exif.length===exif.length);actuallyXmp=Boolean(xmp&&recheck.xmp?.length&&recheck.xmp.length===xmp.length);
      if(actuallyExif||actuallyXmp)blob=new Blob([encoded],{type:mime});
    }catch(err){console.warn('Metadata transfer skipped:',err)}
  }
  const any=actuallyExif||actuallyXmp;
  const all=(!source.exif||actuallyExif)&&(!source.xmp||actuallyXmp)&&!source.icc&&!source.other;
  const state=all&&any?'preserved':any?'partial':'unsupported';
  return {blob,metadata:{state,detail:state==='preserved'?'metadataFull':state==='partial'?'metadataPartial':'metadataNotCopied',exif:actuallyExif,xmp:actuallyXmp,iccSkipped:source.icc}};
}
