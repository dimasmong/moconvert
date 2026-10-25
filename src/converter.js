// All conversions occur on the user's device via browser codecs + two simple binary writers.
export const OUTPUTS = {
  'image/webp': { ext:'webp', note:'formatWebp', quality:true },
  'image/png': { ext:'png', note:'formatPng', quality:false },
  'image/jpeg': { ext:'jpg', note:'formatJpeg', quality:true, flatten:true },
  'image/avif': { ext:'avif', note:'formatAvif', quality:true, optional:true },
  'image/bmp': { ext:'bmp', note:'formatBmp', quality:false, flatten:true },
  'image/x-icon': { ext:'ico', note:'formatIco', quality:false, icon:true }
};
const knownExtensions=new Set(['png','apng','jpg','jpeg','jfif','webp','avif','gif','svg','bmp','ico','tif','tiff','heic','heif','jxl','jp2']);
const knownMimes=new Set(['image/png','image/jpeg','image/webp','image/avif','image/gif','image/svg+xml','image/bmp','image/x-icon','image/vnd.microsoft.icon','image/tiff','image/heic','image/heif','image/jxl']);
export function fileExtension(name){return (name.split('.').pop()||'').toLowerCase()}
export function isImageFile(file){return knownExtensions.has(fileExtension(file.name))||knownMimes.has(file.type)}
export function outputName(name,mime){const ext=OUTPUTS[mime].ext;let base=name.replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().slice(0,110)||'image';return`${base}.${ext}`}
export function prettySize(bytes){if(!Number.isFinite(bytes))return '—';if(bytes<1024)return `${bytes} B`;const units=['KB','MB','GB'];let n=bytes/1024;let i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return `${n>=10?n.toFixed(1):n.toFixed(2)} ${units[i]}`}
export async function canEncode(mime){if(['image/bmp','image/x-icon'].includes(mime))return true;const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;return new Promise(resolve=>{try{canvas.toBlob(blob=>resolve(Boolean(blob&&blob.type===mime)),mime,.8)}catch{resolve(false)}})}
async function decodeImage(file){return new Promise((resolve,reject)=>{
 const url=URL.createObjectURL(file);const image=new Image();let done=false;
 const cleanup=()=>{URL.revokeObjectURL(url);image.onload=null;image.onerror=null};
 image.onload=()=>{if(done)return;done=true;cleanup();if(!image.naturalWidth||!image.naturalHeight)reject(Error('readError'));else resolve(image)};
 image.onerror=()=>{if(done)return;done=true;cleanup();reject(Error('fileUnsupported'))};
 image.src=url;
 });}
async function detectAnimated(file){const ext=fileExtension(file.name);
 if(ext==='gif')return true; // always request consent: GIF can be animated
 if(!['webp','png','apng'].includes(ext))return false;
 const bytes=new Uint8Array(await file.slice(0,Math.min(131072,file.size)).arrayBuffer());
 if(ext==='webp'){const text=new TextDecoder('latin1').decode(bytes.subarray(0,16));if(!text.startsWith('RIFF')||!text.includes('WEBP'))return false;
 return text.slice(12,16)==='VP8X'&&bytes.length>20&&(bytes[20]&2)!==0;
 }
 // APNG acTL chunk, before the first IDAT in an ordinary PNG stream
 for(let i=8;i+12<=bytes.length;){const len=((bytes[i]<<24)|(bytes[i+1]<<16)|(bytes[i+2]<<8)|bytes[i+3])>>>0;const type=String.fromCharCode(...bytes.subarray(i+4,i+8));if(type==='acTL')return true;if(type==='IDAT')return false;if(len>128000)break;i+=len+12;}
 return false;
}
function canvasToBlob(canvas,mime,quality){return new Promise((resolve,reject)=>{
 try{canvas.toBlob(blob=>{if(!blob||blob.type!==mime)reject(Error('encodeError'));else resolve(blob)},mime,quality)}catch{reject(Error('encodeError'))}
});}
function bmpBlob(canvas){const {width:w,height:h}=canvas;const rowStride=(w*3+3)&~3;const bytes=new Uint8Array(54+rowStride*h);const v=new DataView(bytes.buffer);v.setUint16(0,0x4d42,true);v.setUint32(2,bytes.length,true);v.setUint32(10,54,true);v.setUint32(14,40,true);v.setInt32(18,w,true);v.setInt32(22,h,true);v.setUint16(26,1,true);v.setUint16(28,24,true);v.setUint32(34,rowStride*h,true);
 const image=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
 for(let y=0;y<h;y++){const from=y*w*4;const to=54+(h-1-y)*rowStride;for(let x=0;x<w;x++){const i=from+x*4,o=to+x*3;bytes[o]=image[i+2];bytes[o+1]=image[i+1];bytes[o+2]=image[i];}}return new Blob([bytes],{type:'image/bmp'});
}
async function icoBlob(canvas){const png=await canvasToBlob(canvas,'image/png');const pngBytes=new Uint8Array(await png.arrayBuffer());const size=canvas.width;const hdr=new Uint8Array(22);const v=new DataView(hdr.buffer);v.setUint16(0,0,true);v.setUint16(2,1,true);v.setUint16(4,1,true);hdr[6]=size===256?0:size;hdr[7]=size===256?0:size;hdr[8]=0;hdr[9]=0;v.setUint16(10,1,true);v.setUint16(12,32,true);v.setUint32(14,pngBytes.length,true);v.setUint32(18,22,true);return new Blob([hdr,pngBytes],{type:'image/x-icon'});}
export async function convertFile(file,opts){
 const meta=OUTPUTS[opts.mime];if(!meta)throw Error('encodeError');
 if(!opts.firstFrame&&await detectAnimated(file))throw Error('firstFrameRequired');
 const image=await decodeImage(file);const sourceW=image.naturalWidth,sourceH=image.naturalHeight;
 const scale=opts.scale/100;let w=Math.max(1,Math.round(sourceW*scale)),h=Math.max(1,Math.round(sourceH*scale));
 if(meta.icon){w=opts.iconSize;h=opts.iconSize;}
 if(w>16384||h>16384||w*h>45_000_000)throw Error('largeError');
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const context=canvas.getContext('2d',{willReadFrequently:meta.ext==='bmp',alpha:!meta.flatten});if(!context)throw Error('largeError');
 if(meta.flatten){context.fillStyle=opts.bg;context.fillRect(0,0,w,h);}
 context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
 if(meta.icon){const factor=Math.min(w/sourceW,h/sourceH);const dw=sourceW*factor,dh=sourceH*factor;context.drawImage(image,(w-dw)/2,(h-dh)/2,dw,dh);}
 else context.drawImage(image,0,0,w,h);
 let blob;if(meta.icon)blob=await icoBlob(canvas);else if(meta.ext==='bmp')blob=bmpBlob(canvas);else blob=await canvasToBlob(canvas,opts.mime,opts.quality/100);
 // Drop the potentially large canvas backing store promptly
 canvas.width=0;canvas.height=0;
 return {blob,name:outputName(file.name,opts.mime),width:w,height:h};
}
