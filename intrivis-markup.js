/* Intrivis Markup — Final build: working upload + tools + per-page scale + export */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js';

const els = {
  fileInput: document.getElementById('fileInput'),
  dropZone: document.getElementById('dropZone'),
  pages: document.getElementById('pages'),
  thumbs: document.getElementById('thumbs'),
  status: document.getElementById('status'),
  pageIndicator: document.getElementById('pageIndicator'),
  zoomRange: document.getElementById('zoomRange'),
  scaleIndicator: document.getElementById('scaleIndicator'),
  color: document.getElementById('color'),
  strokeWidth: document.getElementById('strokeWidth')
};
function setStatus(t){ els.status.textContent = t; console.log('[status]', t); }

let pdfDoc = null;
let currentPage = 1;
let scale = parseInt(els.zoomRange.value || 150) / 100;
const pages = []; // {canvas, svg, viewport, wrap, pxPerUnit:null}

// Tools
const Tool = { PAN:'pan', PEN:'pen', RECT:'rect', ELLIPSE:'ellipse', HL:'hl', MEASURE:'measure', TEXT:'text', STAMP:'stamp', ERASER:'eraser' };
let activeTool = Tool.PAN;
const STAMPS = [
  {name:'Approved', data:'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><rect rx="6" ry="6" width="160" height="48" fill="#cce5ff"/><text x="80" y="32" font-size="18" font-family="Arial" text-anchor="middle" fill="#023e8a">APPROVED</text></svg>')},
  {name:'Rev', data:'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect rx="6" ry="6" width="120" height="40" fill="#fff3bf"/><text x="60" y="26" font-size="16" font-family="Arial" text-anchor="middle" fill="#b45f06">REVISION</text></svg>')},
  {name:'Issue', data:'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="34"><rect rx="6" ry="6" width="100" height="34" fill="#ffd6d6"/><text x="50" y="22" font-size="14" font-family="Arial" text-anchor="middle" fill="#7f0000">ISSUE</text></svg>')}
];
let currentStamp = STAMPS[0];

// UI bindings
document.getElementById('btnOpen').addEventListener('click', ()=> els.fileInput.click());
document.getElementById('btnSavePdf').addEventListener('click', exportAnnotatedPdf);
document.getElementById('toggleThumbs').addEventListener('click', ()=> document.getElementById('thumbs').classList.toggle('hidden'));
document.getElementById('setScale').addEventListener('click', ()=> promptScaleForPage(currentPage));

document.getElementById('penTool').addEventListener('click', ()=> setTool(Tool.PEN));
document.getElementById('rectTool').addEventListener('click', ()=> setTool(Tool.RECT));
document.getElementById('ellipseTool').addEventListener('click', ()=> setTool(Tool.ELLIPSE));
document.getElementById('hlTool').addEventListener('click', ()=> setTool(Tool.HL));
document.getElementById('measureTool').addEventListener('click', ()=> setTool(Tool.MEASURE));
document.getElementById('textTool').addEventListener('click', ()=> setTool(Tool.TEXT));
document.getElementById('stampTool').addEventListener('click', ()=> setTool(Tool.STAMP));
document.getElementById('eraserTool').addEventListener('click', ()=> setTool(Tool.ERASER));
document.getElementById('panTool').addEventListener('click', ()=> setTool(Tool.PAN));

function setTool(t){
  activeTool = t;
  document.querySelectorAll('.tool').forEach(b=>b.classList.remove('active'));
  const map = {pan:'panTool',pen:'penTool',rect:'rectTool',ellipse:'ellipseTool',hl:'hlTool',measure:'measureTool',text:'textTool',stamp:'stampTool',eraser:'eraserTool'};
  const id = map[t.toLowerCase()] || map[t];
  if(id && document.getElementById(id)) document.getElementById(id).classList.add('active');
  setStatus('Tool: '+t);
}
setTool(Tool.PAN);

// paging & zoom
document.getElementById('prevPage').addEventListener('click', ()=> gotoPage(Math.max(1,currentPage-1)));
document.getElementById('nextPage').addEventListener('click', ()=> gotoPage(Math.min(pages.length,currentPage+1)));
els.zoomRange.addEventListener('input', ()=>{ scale = parseInt(els.zoomRange.value)/100; layoutPages(); });

document.getElementById('fitWidth').addEventListener('click', ()=> fit('width'));
document.getElementById('fitPage').addEventListener('click', ()=> fit('page'));

function fit(mode){
  if(!pages.length) return;
  const container = document.querySelector('.viewer-area');
  const p = pages[currentPage-1];
  const cs = container.clientWidth - 40; const ch = container.clientHeight - 100;
  if(mode==='width') scale = Math.max(0.1, Math.min(3, cs / p.viewport.width));
  else scale = Math.max(0.1, Math.min(3, Math.min(cs / p.viewport.width, ch / p.viewport.height)));
  els.zoomRange.value = Math.round(scale*100);
  layoutPages();
}

// upload handlers (robust)
['dragenter','dragover'].forEach(ev=> els.dropZone.addEventListener(ev, e=>{ e.preventDefault(); els.dropZone.style.borderColor='#0b84ff'; }));
['dragleave','drop'].forEach(ev=> els.dropZone.addEventListener(ev, e=>{ e.preventDefault(); els.dropZone.style.borderColor='rgba(255,255,255,0.15)'; }));
els.dropZone.addEventListener('drop', async e=>{ const f = e.dataTransfer.files && e.dataTransfer.files[0]; if(f) await handleFile(f); });
els.fileInput.addEventListener('change', async e=>{ const f = e.target.files[0]; if(f) await handleFile(f); });

async function handleFile(file){
  try{
    if(!file) return;
    if(file.type !== 'application/pdf' && !file.name.toLowerCase().endswith('.pdf')){ alert('Please provide a PDF file'); return; }
    setStatus('Reading file: '+file.name+' ('+Math.round(file.size/1024/1024)+' MB)');
    if(file.size > 200*1024*1024) if(!confirm('File is large (>200MB). Continue?')) return;
    const ab = await file.arrayBuffer();
    await loadPdf(ab, file.name);
  }catch(err){ console.error(err); alert('Failed to read file: '+err.message); setStatus('File read failed'); }
}

async function loadPdf(arrayBuffer, filename){
  try{
    setStatus('Loading PDF...');
    const loading = pdfjsLib.getDocument({data: arrayBuffer, nativeImageDecoderSupport: 'display'});
    pdfDoc = await loading.promise;
    document.getElementById('title').textContent = filename || 'Intrivis Markup';
    els.pages.innerHTML = ''; els.thumbs.innerHTML = ''; pages.length = 0;
    for(let i=1;i<=pdfDoc.numPages;i++){
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({scale:1});
      const wrap = document.createElement('div'); wrap.className='page-wrap';
      const canvas = document.createElement('canvas'); canvas.className='pdf-canvas'; canvas.width = viewport.width; canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({canvasContext: ctx, viewport}).promise;
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.classList.add('overlay');
      svg.setAttribute('width', viewport.width); svg.setAttribute('height', viewport.height);
      wrap.appendChild(canvas); wrap.appendChild(svg);
      els.pages.appendChild(wrap);
      const th = document.createElement('div'); th.className='thumb'; th.textContent = 'Page '+i; th.addEventListener('click', ()=> scrollToPage(i));
      els.thumbs.appendChild(th);
      pages.push({canvas, svg, viewport, wrap, pxPerUnit: null});
      attachToolHandlers(pages[i-1]);
    }
    layoutPages(); gotoPage(1); setStatus('Loaded '+pdfDoc.numPages+' pages');
  }catch(err){ console.error(err); alert('Could not open PDF: '+err.message); setStatus('Load failed'); }
}

function layoutPages(){ for(const p of pages){ const w = p.viewport.width * scale, h = p.viewport.height * scale; p.wrap.style.width = w+'px'; p.wrap.style.height = h+'px'; p.canvas.style.width = w+'px'; p.canvas.style.height = h+'px'; p.svg.style.width = w+'px'; p.svg.style.height = h+'px'; } }

function scrollToPage(n){ const p = pages[n-1]; if(!p) return; p.wrap.scrollIntoView({behavior:'smooth', block:'center'}); gotoPage(n); }
function gotoPage(n){ if(!pages.length) return; currentPage = n; els.pageIndicator.textContent = n+' / '+pages.length; Array.from(els.thumbs.children).forEach((t,idx)=> t.style.outline = (idx+1===n)?'2px solid var(--accent)':''); updateScaleIndicator(); }
function updateScaleIndicator(){ const p = pages[currentPage-1]; if(!p) { els.scaleIndicator.textContent='Scale: -'; return; } els.scaleIndicator.textContent = 'Scale: ' + (p.pxPerUnit? (p.pxPerUnit.toFixed(4)+' px/unit') : 'not set'); }

// Tools on overlay
function attachToolHandlers(page){
  const svg = page.svg;
  let drawing=false, start=null, current=null;
  function clientToSvg(ev){
    const r = svg.getBoundingClientRect();
    const sx = svg.width.baseVal.value / r.width;
    const sy = svg.height.baseVal.value / r.height;
    return { x:(ev.clientX - r.left)*sx, y:(ev.clientY - r.top)*sy };
  }

  svg.addEventListener('pointerdown', ev=>{
    if(activeTool === Tool.PAN) return;
    ev.preventDefault(); svg.setPointerCapture(ev.pointerId);
    const p = clientToSvg(ev); start = p; drawing = true;
    const color = els.color.value || '#ff0000'; const sw = parseFloat(els.strokeWidth.value || '2');
    if(activeTool === Tool.PEN){
      current = create('path',{d:`M ${p.x} ${p.y}`, fill:'none', stroke:color, 'stroke-width':sw, 'stroke-linecap':'round','stroke-linejoin':'round'});
      current.setAttribute('data-annot','pen'); svg.appendChild(current);
    } else if(activeTool === Tool.RECT || activeTool === Tool.HL){
      current = create('rect',{x:p.x,y:p.y,width:1,height:1,stroke:color,'stroke-width':sw, fill:(activeTool===Tool.HL?'rgba(255,255,0,0.35)':'none')});
      current.setAttribute('data-annot', activeTool==='hl'?'highlight':'rect');
      svg.appendChild(current);
    } else if(activeTool === Tool.ELLIPSE){
      current = create('ellipse',{cx:p.x,cy:p.y,rx:1,ry:1,stroke:color,'stroke-width':sw,fill:'none'});
      current.setAttribute('data-annot','ellipse'); svg.appendChild(current);
    } else if(activeTool === Tool.MEASURE){
      if(!page.pxPerUnit){ alert('Set scale for this page first'); drawing=false; return; }
      current = create('line',{x1:p.x,y1:p.y,x2:p.x,y2:p.y,stroke:color,'stroke-width':sw});
      current.setAttribute('data-annot','measure'); svg.appendChild(current);
    } else if(activeTool === Tool.TEXT){
      const txt = prompt('Enter text'); if(txt){ const t = create('text',{x:p.x,y:p.y+12,fill:color,'font-size':14}); t.textContent = txt; t.setAttribute('data-annot','text'); svg.appendChild(t); }
      drawing=false;
    } else if(activeTool === Tool.STAMP){
      const img = create('image',{x:p.x-60,y:p.y-20,width:120,height:40}); img.setAttributeNS('http://www.w3.org/1999/xlink','href', currentStamp.data); img.setAttribute('data-annot','stamp'); svg.appendChild(img);
      drawing=false;
    } else if(activeTool === Tool.ERASER){
      const t = ev.target; if(t && t !== svg) t.remove();
      drawing=false;
    }
  });

  svg.addEventListener('pointermove', ev=>{
    if(!drawing || !current) return;
    const p = clientToSvg(ev);
    if(current.tagName === 'path'){
      current.setAttribute('d', current.getAttribute('d') + ` L ${p.x} ${p.y}`);
    } else if(current.tagName === 'rect'){
      const x = Math.min(start.x,p.x), y = Math.min(start.y,p.y);
      const w = Math.abs(p.x-start.x), h = Math.abs(p.y-start.y);
      current.setAttribute('x',x); current.setAttribute('y',y); current.setAttribute('width',w); current.setAttribute('height',h);
    } else if(current.tagName === 'ellipse'){
      const rx = Math.abs(p.x - start.x), ry = Math.abs(p.y - start.y);
      current.setAttribute('cx', start.x); current.setAttribute('cy', start.y); current.setAttribute('rx', rx); current.setAttribute('ry', ry);
    } else if(current.tagName === 'line'){
      current.setAttribute('x2', p.x); current.setAttribute('y2', p.y);
    }
  });

  svg.addEventListener('pointerup', ev=>{
    if(!drawing) return;
    drawing=false; try{ svg.releasePointerCapture(ev.pointerId); }catch(e){}
    if(current && current.getAttribute('data-annot') === 'measure'){
      const x1 = parseFloat(current.getAttribute('x1')), y1 = parseFloat(current.getAttribute('y1'));
      const x2 = parseFloat(current.getAttribute('x2')), y2 = parseFloat(current.getAttribute('y2'));
      const px = Math.hypot(x2-x1,y2-y1);
      const value = px / (page.pxPerUnit || 1);
      const label = create('text',{class:'measure-label', x:(x1+x2)/2, y:(y1+y2)/2 - 6, fill:'#111'});
      label.textContent = value.toFixed(2) + ' unit';
      svg.appendChild(label);
    }
    current = null; start = null;
  });
}

// helper to create svg elements
function create(tag, attrs){
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for(const k in attrs){
    if(k === 'href') el.setAttributeNS('http://www.w3.org/1999/xlink','href', attrs[k]);
    else el.setAttribute(k, attrs[k]);
  }
  return el;
}

// Set per-page scale: free-input units
function promptScaleForPage(pageNum){
  const p = pages[pageNum-1]; if(!p) return;
  const input = prompt('Enter real-world length for a drawn line in your chosen unit (e.g., enter 1000).\nAfter OK, click two points on the page to define the line length.');
  if(input === null) return;
  const real = parseFloat(input); if(!(real>0)){ alert('Invalid number'); return; }
  setStatus('Click two points to measure that real length');
  let first = null;
  const handler = (ev)=>{
    ev.preventDefault();
    const pt = clientToSvg(p.svg, ev);
    if(!first){ first = pt; setStatus('Click second point...'); }
    else {
      p.svg.removeEventListener('click', handler);
      const distPx = Math.hypot(pt.x - first.x, pt.y - first.y);
      p.pxPerUnit = distPx / real; // pixels per unit
      updateScaleIndicator();
      alert('Scale set for page '+pageNum+': '+p.pxPerUnit.toFixed(4)+' px per unit');
      setStatus('Scale set');
    }
  };
  p.svg.addEventListener('click', handler);
}

function clientToSvg(svg, ev){
  const r = svg.getBoundingClientRect();
  const sx = svg.width.baseVal.value / r.width;
  const sy = svg.height.baseVal.value / r.height;
  return { x:(ev.clientX - r.left)*sx, y:(ev.clientY - r.top)*sy };
}

// Export without cutting: compose at original canvas size
async function exportAnnotatedPdf(){
  if(!pages.length){ alert('Load a PDF first'); return; }
  setStatus('Preparing export...');
  const { jsPDF } = window.jspdf;
  const first = pages[0];
  const ptW = first.canvas.width * 72 / 96;
  const ptH = first.canvas.height * 72 / 96;
  const doc = new jsPDF({unit:'pt', format:[ptW, ptH]});
  for(let i=0;i<pages.length;i++){
    const p = pages[i];
    const composed = await composeCanvasAndSvg(p.canvas, p.svg);
    const data = composed.toDataURL('image/png');
    if(i>0) doc.addPage([p.canvas.width * 72 / 96, p.canvas.height * 72 / 96]);
    doc.addImage(data, 'PNG', 0, 0, p.canvas.width * 72 / 96, p.canvas.height * 72 / 96);
  }
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'intrivis-annotated.pdf'; a.click(); URL.revokeObjectURL(url);
  setStatus('Export complete');
}

async function composeCanvasAndSvg(canvas, svg){
  const w = canvas.width, h = canvas.height;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const clone = svg.cloneNode(true);
  if(!clone.getAttribute('xmlns')) clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone);
  const img = await svgToImage(xml);
  ctx.drawImage(img, 0, 0, w, h);
  return out;
}
function svgToImage(xml){
  return new Promise((res, rej)=>{
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    const img = new Image();
    img.onload = ()=> res(img);
    img.onerror = (e)=> rej(e);
    img.src = src;
  });
}

// utilities
function updateScaleIndicator(){ const p = pages[currentPage-1]; if(!p) els.scaleIndicator.textContent = 'Scale: -'; else els.scaleIndicator.textContent = 'Scale: ' + (p.pxPerUnit? p.pxPerUnit.toFixed(4)+' px/unit':'not set'); }

// keyboard
document.addEventListener('keydown', e=>{ if(e.ctrlKey && e.key==='o'){ e.preventDefault(); document.getElementById('btnOpen').click(); } if(e.key==='Escape') setTool(Tool.PAN); });

// error reporting
window.addEventListener('error', e=> setStatus('Error: '+e.message));
