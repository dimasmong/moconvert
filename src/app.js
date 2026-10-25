import { translate, normalizeLang } from './i18n.js';
import { OUTPUTS, canEncode, isImageFile, convertFile, outputName, prettySize, fileExtension } from './converter.js';
import { createZip } from './zip.js';

const $ = id => document.getElementById(id);
const elements={
 language:$('language'),themeBtn:$('themeBtn'),themeLabel:$('themeLabel'),themeIcon:$('themeIcon'),files:$('files'),dropZone:$('dropZone'),chooseBtn:$('chooseBtn'),
 output:$('outputFormat'),formatNote:$('formatNote'),quality:$('quality'),qualityValue:$('qualityValue'),qualityField:$('qualityField'),resize:$('resize'),iconSize:$('iconSize'),iconField:$('iconField'),bgField:$('bgField'),bgColor:$('bgColor'),bgHex:$('bgHex'),firstFrame:$('firstFrame'),
 queue:$('queue'),fileList:$('fileList'),fileCount:$('fileCount'),convertBtn:$('convertBtn'),clearBtn:$('clearBtn'),downloadZipBtn:$('downloadZipBtn'),totalCount:$('totalCount'),doneCount:$('doneCount'),originalTotal:$('originalTotal'),convertedTotal:$('convertedTotal'),queueFooterInfo:$('queueFooterInfo'),globalProgress:$('globalProgress'),progressMessage:$('progressMessage'),progressPercent:$('progressPercent'),progressBar:$('progressBar'),toast:$('toast')
};
const getStorage=(key,fallback)=>{try{return localStorage.getItem(key)??fallback}catch{return fallback}};
const setStorage=(key,val)=>{try{localStorage.setItem(key,val)}catch{}};
let lang=normalizeLang(getStorage('moconvert-lang','en'));
let theme=getStorage('moconvert-theme','light')==='dark'?'dark':'light';
let records=[];let nextId=1;let busy=false;let generation=0;let toastTimer;
const t=(key,values)=>translate(lang,key,values);
function toast(message){clearTimeout(toastTimer);elements.toast.textContent=message;elements.toast.classList.add('show');toastTimer=setTimeout(()=>elements.toast.classList.remove('show'),3300)}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,match=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[match]))}
function applyLanguage(){document.documentElement.lang=lang;elements.language.value=lang;document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=t(node.dataset.i18n)});
 elements.dropZone.setAttribute('aria-label',t('chooseAria'));elements.qualityValue.textContent=elements.quality.value+'%';updateSettingsUI();applyTheme();render();}
function applyTheme(){document.documentElement.dataset.theme=theme;elements.themeIcon.textContent=theme==='dark'?'☀':'☾';elements.themeLabel.textContent=t(theme==='dark'?'themeLight':'themeDark');elements.themeBtn.title=t(theme==='dark'?'themeToLight':'themeToDark');elements.themeBtn.setAttribute('aria-label',elements.themeBtn.title);document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#111422':'#f7f8fd'}
function updateSettingsUI(){const mime=elements.output.value;const opt=OUTPUTS[mime];elements.qualityField.hidden=!opt.quality;elements.iconField.hidden=!opt.icon;elements.resize.closest('.setting-field').hidden=Boolean(opt.icon);elements.bgField.hidden=!opt.flatten;elements.formatNote.textContent=t(opt.note);elements.qualityValue.textContent=elements.quality.value+'%';elements.bgHex.textContent=elements.bgColor.value.toUpperCase();}
function resetResults(showMessage){for(const record of records){if(record.outURL)URL.revokeObjectURL(record.outURL);record.outURL=null;record.result=null;record.status='queued';record.error=null;}elements.globalProgress.hidden=true;render();if(showMessage&&records.length)toast(t('statusUpdated'));}
function captureOptions(){return {mime:elements.output.value,quality:Number(elements.quality.value),scale:Number(elements.resize.value),iconSize:Number(elements.iconSize.value),bg:elements.bgColor.value,firstFrame:elements.firstFrame.checked};}
function extensionOrType(file){return (fileExtension(file.name)||file.type.split('/')[1]||'?').toUpperCase()}
function render(){const total=records.length,done=records.filter(r=>r.status==='ready'),failed=records.filter(r=>r.status==='failed').length;
 elements.queue.hidden=!total;elements.fileCount.textContent=total;elements.totalCount.textContent=total;elements.doneCount.textContent=done.length;
 elements.originalTotal.textContent=prettySize(records.reduce((s,r)=>s+r.file.size,0));elements.convertedTotal.textContent=done.length?prettySize(done.reduce((s,r)=>s+r.result.blob.size,0)):t('emptyResult');
 elements.downloadZipBtn.disabled=busy||!done.length;elements.convertBtn.disabled=busy||!records.length;elements.clearBtn.disabled=busy;elements.files.disabled=busy;elements.chooseBtn.disabled=busy;
 for(const control of [elements.output,elements.quality,elements.resize,elements.iconSize,elements.bgColor,elements.firstFrame])control.disabled=busy;
 elements.queueFooterInfo.textContent=done.length||failed?t('doneFooter',{done:done.length,failed}):t('queueFoot');
 elements.fileList.innerHTML=records.map(record=>{
  const status=t(record.status);const tagClass=record.status==='ready'?' success':record.status==='failed'?' error':'';
  const preview=record.previewURL&&(!['heic','heif','tiff','tif','jxl'].includes(fileExtension(record.file.name)))?`<img loading="lazy" class="preview" alt="" src="${record.previewURL}" />`:`<div class="preview">${escapeHtml(extensionOrType(record.file).slice(0,5))}</div>`;
  const meta=record.result?`${t('originalLabel')}: ${prettySize(record.file.size)} · ${t('resultLabel')}: <strong>${prettySize(record.result.blob.size)}</strong> · ${record.result.width} × ${record.result.height}`:`${extensionOrType(record.file)} · ${prettySize(record.file.size)}`;
  const error=record.error?`<div class="file-error">${escapeHtml(t(record.error))}</div>`:'';
  const action=record.result?`<button type="button" class="file-action" data-action="download" data-id="${record.id}">${t('download')} ↓</button>`:'';
  return `<div class="file-item">${preview}<div class="file-info"><div class="file-name" title="${escapeHtml(record.file.name)}">${escapeHtml(record.file.name)}</div><div class="file-meta">${meta}</div>${error}</div><div class="file-actions">${action}<span class="state-tag${tagClass}">${status}</span><button type="button" class="file-action" data-action="remove" data-id="${record.id}" ${busy?'disabled':''} aria-label="${t('remove')}">×</button></div></div>`;
 }).join('');}
function dispose(record){if(record.previewURL)URL.revokeObjectURL(record.previewURL);if(record.outURL)URL.revokeObjectURL(record.outURL)}
function addFiles(input){if(busy)return;let added=0,oversized=0,bad=0,duplicates=0;
 for(const file of input){if(records.length>=60){toast(t('limitReached'));break;}if(!isImageFile(file)){bad++;continue;}if(file.size>75*1024*1024){oversized++;continue;}if(records.some(r=>r.file.name===file.name&&r.file.size===file.size&&r.file.lastModified===file.lastModified)){duplicates++;continue;}
  records.push({id:nextId++,file,previewURL:URL.createObjectURL(file),outURL:null,result:null,status:'queued',error:null});added++;
 }
 if(added){resetResults(false);toast(t('fileAdded',{count:added}));}else if(oversized)toast(t('oversized'));else if(bad)toast(t('badFiles'));else if(duplicates)toast(t('duplicate'));
}
function downloadBlob(blob,name,url){const temp=!url;const href=url??URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=name;document.body.append(a);a.click();a.remove();if(temp)setTimeout(()=>URL.revokeObjectURL(href),120000);}
async function convertAll(){if(busy||!records.length){if(!records.length)toast(t('noFiles'));return;}const opts=captureOptions();if(!await canEncode(opts.mime)){toast(t('formatNoAvif'));return;}
 busy=true;const token=++generation;resetResults(false);elements.globalProgress.hidden=false;render();
 for(let i=0;i<records.length;i++){
  if(generation!==token)break;const record=records[i];record.status='processing';render();elements.progressMessage.textContent=t('convertingIndex',{current:i+1,total:records.length});elements.progressPercent.textContent=Math.floor(i/records.length*100)+'%';elements.progressBar.style.width=Math.floor(i/records.length*100)+'%';
  await new Promise(resolve=>setTimeout(resolve,15));
  try{record.result=await convertFile(record.file,opts);record.outURL=URL.createObjectURL(record.result.blob);record.status='ready';}
  catch(error){record.status='failed';record.error=(['firstFrameRequired','fileUnsupported','largeError','readError','encodeError'].includes(error.message)?error.message:'readError');console.warn('MoConvert image conversion failed:',error);}
  elements.progressPercent.textContent=Math.round((i+1)/records.length*100)+'%';elements.progressBar.style.width=Math.round((i+1)/records.length*100)+'%';render();
 }
 busy=false;render();elements.globalProgress.hidden=true;toast(t('finished'));
}
async function zipDownload(){if(busy)return;const successful=records.filter(r=>r.result);if(!successful.length){toast(t('nothingReady'));return;}
 busy=true;render();elements.progressMessage.textContent=t('zipBuilding');elements.progressPercent.textContent='';elements.globalProgress.hidden=false;elements.progressBar.style.width='100%';
 try{const used=new Set();const entries=successful.map(record=>{let name=record.result.name;let count=2;while(used.has(name.toLowerCase())){const pos=name.lastIndexOf('.');const basename=record.result.name.slice(0,record.result.name.lastIndexOf('.'));name=`${basename}-${count++}.${OUTPUTS[elements.output.value].ext}`;}used.add(name.toLowerCase());return{name,blob:record.result.blob};});const blob=await createZip(entries);downloadBlob(blob,t('downloadName'));}
 catch(err){console.warn('ZIP error',err);toast(t('zipError'));}
 finally{busy=false;elements.globalProgress.hidden=true;render()}
}
async function detectFormats(){for(const [mime,meta] of Object.entries(OUTPUTS)){if(meta.optional){const supported=await canEncode(mime);const option=Array.from(elements.output.options).find(o=>o.value===mime);if(option){option.disabled=!supported;option.title=!supported?t('formatNoAvif'):'';}}}if(!await canEncode(elements.output.value))elements.output.value='image/png';updateSettingsUI()}
function init(){elements.language.addEventListener('change',()=>{lang=normalizeLang(elements.language.value);setStorage('moconvert-lang',lang);applyLanguage()});elements.themeBtn.addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';setStorage('moconvert-theme',theme);applyTheme()});
 elements.chooseBtn.addEventListener('click',()=>elements.files.click());elements.dropZone.addEventListener('click',event=>{if(event.target.closest('button'))return;elements.files.click()});elements.dropZone.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();elements.files.click()}});
 elements.files.addEventListener('change',event=>{addFiles(Array.from(event.target.files));elements.files.value='';});
 ['dragenter','dragover'].forEach(type=>elements.dropZone.addEventListener(type,event=>{event.preventDefault();if(!busy){event.dataTransfer.dropEffect='copy';elements.dropZone.classList.add('dragging')}}));
 elements.dropZone.addEventListener('dragleave',event=>{if(!elements.dropZone.contains(event.relatedTarget))elements.dropZone.classList.remove('dragging')});elements.dropZone.addEventListener('drop',event=>{event.preventDefault();elements.dropZone.classList.remove('dragging');addFiles(Array.from(event.dataTransfer.files))});
 window.addEventListener('dragover',event=>event.preventDefault());window.addEventListener('drop',event=>{if(!event.target.closest('.dropzone'))event.preventDefault()});
 for(const input of [elements.output,elements.quality,elements.resize,elements.iconSize,elements.bgColor,elements.firstFrame])input.addEventListener(input===elements.quality||input===elements.bgColor?'input':'change',()=>{updateSettingsUI();resetResults(true)});
 elements.convertBtn.addEventListener('click',convertAll);elements.downloadZipBtn.addEventListener('click',zipDownload);
 elements.clearBtn.addEventListener('click',()=>{if(busy)return;for(const record of records)dispose(record);records=[];generation++;elements.globalProgress.hidden=true;render()});
 elements.fileList.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;const record=records.find(r=>r.id===Number(button.dataset.id));if(!record)return;if(button.dataset.action==='download'&&record.result)downloadBlob(record.result.blob,record.result.name,record.outURL);if(button.dataset.action==='remove'&&!busy){dispose(record);records=records.filter(r=>r!==record);render()}});
 window.addEventListener('pagehide',()=>{records.forEach(dispose)});
 applyLanguage();applyTheme();detectFormats();
}
init();
