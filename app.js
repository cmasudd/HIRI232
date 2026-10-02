'use strict';
const $ = id => document.getElementById(id);
const VARIABLES = [
  {key:'pm25_ugm3', label:'Material particulado PM 2.5', short:'PM 2.5', unit:'µg/m³', instrument:'PMS5003', icon:'◌', color:'#007f85'},
  {key:'pm1_ugm3', label:'Material particulado PM 1.0', short:'PM 1.0', unit:'µg/m³', instrument:'PMS5003', icon:'◌', color:'#269e9b'},
  {key:'pm10_ugm3', label:'Material particulado PM 10', short:'PM 10', unit:'µg/m³', instrument:'PMS5003', icon:'◌', color:'#467d9e'},
  {key:'pms_temperature_c', label:'Temperatura PMS5003', short:'Temperatura', unit:'°C', instrument:'PMS5003', icon:'°', color:'#b57d4a'},
  {key:'pms_humidity_pct', label:'Humedad PMS5003', short:'Humedad', unit:'%', instrument:'PMS5003', icon:'⋄', color:'#467d9e'},
  {key:'sht_temperature_c', label:'Temperatura SHT40', short:'Temperatura', unit:'°C', instrument:'SHT40', icon:'°', color:'#b57d4a'},
  {key:'sht_humidity_pct', label:'Humedad SHT40', short:'Humedad', unit:'%', instrument:'SHT40', icon:'⋄', color:'#467d9e'},
  {key:'signal', label:'Intensidad de señal telefónica', short:'Señal telefónica', unit:'adimensional', instrument:'SIM7600G', icon:'▥', color:'#789556'}
];
let config, rows = [], chart, stationMap, stationMarker, refreshTimer, authenticated = false, loading = false;
const HEALTH_CATEGORIES = [
  {label:'Buena',color:'#22845a',note:'Menor nivel de preocupación por contaminación.'},
  {label:'Moderada',color:'#b18a18',note:'Puede afectar a personas especialmente sensibles.'},
  {label:'Dañina para grupos sensibles',color:'#c46b27',note:'Mayor preocupación para personas sensibles.'},
  {label:'Dañina',color:'#c44448',note:'Puede afectar a la población general.'},
  {label:'Muy dañina',color:'#8c559d',note:'Preocupación elevada para toda la población.'},
  {label:'Peligrosa',color:'#79384c',note:'Nivel de preocupación más alto de la escala.'}
];
const HEALTH_SCALES = {
  pm25_ugm3:{upper:[9,35.4,55.4,125.4,225.4,Infinity],labels:['0–9,0','9,1–35,4','35,5–55,4','55,5–125,4','125,5–225,4','≥225,5'],decimals:1,reference:50},
  pm10_ugm3:{upper:[54,154,254,354,424,Infinity],labels:['0–54','55–154','155–254','255–354','355–424','≥425'],decimals:0,reference:130}
};
function healthCategory(value,key) {
  const scale=HEALTH_SCALES[key];
  if(!scale||value===null||!Number.isFinite(value)||value<0)return null;
  const factor=10**scale.decimals, truncated=Math.floor(value*factor)/factor;
  return HEALTH_CATEGORIES[scale.upper.findIndex(limit=>truncated<=limit)];
}
function dailyGroups(data,key) {
  const hours=new Map();
  for(const row of data) {if(row[key]===null||!Number.isFinite(row[key])||(key.endsWith('_ugm3')&&row[key]<0))continue;const time=Math.floor(new Date(row.timestamp).getTime()/3600000)*3600000;const h=hours.get(time)||{sum:0,count:0,min:Infinity,max:-Infinity};h.sum+=row[key];h.count++;h.min=Math.min(h.min,row[key]);h.max=Math.max(h.max,row[key]);hours.set(time,h);}
  const days=new Map();
  for(const [time,h] of hours){const day=localDay(new Date(time).toISOString()),d=days.get(day)||{sum:0,count:0,min:Infinity,max:-Infinity};d.sum+=h.sum/h.count;d.count++;d.min=Math.min(d.min,h.min);d.max=Math.max(d.max,h.max);days.set(day,d);}
  return [...days].sort(([a],[b])=>a.localeCompare(b)).map(([day,d])=>({label:day,value:d.sum/d.count,hours:d.count,min:d.min,max:d.max}));
}
function dailyReference(data,key,now=Date.now()) {
  const today=localDay(new Date(now).toISOString());
  const yesterday=new Date(new Date(`${today}T12:00:00Z`).getTime()-86400000).toISOString().slice(0,10);
  const result=dailyGroups(data,key).find(d=>d.label===yesterday);
  return {day:yesterday,hours:result?.hours||0,value:result&&result.hours>=18?result.value:null,category:result&&result.hours>=18?healthCategory(result.value,key):null};
}
function renderDailySummary() {
  $('daily-summary').innerHTML=['pm25_ugm3','pm10_ugm3'].map(key=>{
    const v=VARIABLES.find(v=>v.key===key),r=dailyReference(rows,key),c=r.category;
    return `<article class="daily-reading"><div><b>${v.short}</b><span class="health-chip" style="--health-color:${c?.color||'#657a80'}">${c?.label||'Datos insuficientes'}</span></div><strong>${format(r.value)} <small>µg/m³</small></strong><p>${r.day} · ${r.hours} horas con datos${config.data.mode==='demo'?' · simulado':''}</p></article>`;
  }).join('');
}
function renderHealthLegend(key) {
  const scale=HEALTH_SCALES[key];
  $('quality-legend').hidden=!scale;
  if(!scale)return;
  const v=VARIABLES.find(v=>v.key===key);
  $('scale-title').textContent=`${v.short} · referencia chilena ${scale.reference} ${key==='pm10_ugm3'?'µg/m³N':'µg/m³'}`;
  const ticks=referenceTicks(key);
  $('quality-bands').className='reference-scale';
  $('quality-bands').innerHTML=`<div class="reference-gradient"></div><div class="reference-ticks">${ticks.map((tick,i)=>`<span>${i===ticks.length-1?'≥':''}${tick}</span>`).join('')}</div>`;
  $('scale-note').textContent='Escala cromática visual: el rojo marca la referencia diaria chilena. Una lectura puntual no determina cumplimiento. Los rangos de salud EPA se detallan en la sección de interpretación.';
}
const REFERENCE_COLORS=['#269d62','#f2c94c','#dc493a','#9b3f91','#6b267e','#42145f'];
function referenceTicks(key){return key==='pm25_ugm3'?[0,25,50,75,100,500]:key==='pm10_ugm3'?[0,65,130,195,260,500]:null;}
function referenceColor(value,key){
  const ticks=referenceTicks(key);if(!ticks||value===null||!Number.isFinite(value))return VARIABLES.find(v=>v.key===key)?.color||'#007f85';
  if(value<=0)return REFERENCE_COLORS[0];
  for(let i=1;i<ticks.length;i++){if(value<=ticks[i]){const ratio=(value-ticks[i-1])/(ticks[i]-ticks[i-1]);const mix=offset=>Math.round(parseInt(REFERENCE_COLORS[i-1].slice(offset,offset+2),16)*(1-ratio)+parseInt(REFERENCE_COLORS[i].slice(offset,offset+2),16)*ratio).toString(16).padStart(2,'0');return '#'+mix(1)+mix(3)+mix(5);}}
  return REFERENCE_COLORS.at(-1);
}
function latestHourly(data,key){
  const last=data.findLast(r=>Number.isFinite(r[key]));if(!last)return null;
  const start=Math.floor(new Date(last.timestamp).getTime()/3600000)*3600000;
  const values=data.filter(r=>{const time=new Date(r.timestamp).getTime();return time>=start&&time<start+3600000&&Number.isFinite(r[key]);}).map(r=>r[key]);
  return {value:values.reduce((a,b)=>a+b,0)/values.length,timestamp:last.timestamp};
}
function renderHistorySummary(variable,points){
  const last=latestHourly(rows,variable.key),daily=dailyReference(rows,variable.key),scale=HEALTH_SCALES[variable.key];
  $('history-last').textContent=last?`${format(last.value)} ${variable.unit}`:'—';
  $('history-last-time').textContent=last?dateFormat.format(new Date(last.timestamp)):'Sin mediciones';
  const state=$('history-reference');state.className='';
  if(!scale){state.textContent='Sin referencia';$('history-reference-detail').textContent='Esta variable no tiene una referencia chilena configurada.';}
  else if(daily.value===null){state.textContent='Datos insuficientes';$('history-reference-detail').textContent=`${daily.day} · ${daily.hours}/18 horas requeridas`;}
  else{state.textContent=daily.value<scale.reference?'Bajo referencia':daily.value>scale.reference?'Sobre referencia':'En referencia';state.className=daily.value<scale.reference?'below-reference':'above-reference';$('history-reference-detail').textContent=`${format(daily.value)} ${variable.unit} · ${daily.day} · ${variable.key==='pm25_ugm3'?'DS 12/2011':'DS 12/2021'}${config.data.mode==='demo'?' · simulado':''}`;}
  $('history-coverage').textContent=points.length?'Con datos':'Sin datos';$('history-coverage-detail').textContent=`${points.length.toLocaleString('es-CL')} observaciones válidas en la selección`;
}
function fillDailyGaps(grouped){
  if(!grouped.length)return [];const days=new Map(grouped.map(p=>[p.label,p])),result=[];
  for(let time=Date.parse(grouped[0].label+'T12:00:00Z'),end=Date.parse(grouped.at(-1).label+'T12:00:00Z');time<=end;time+=86400000){const label=new Date(time).toISOString().slice(0,10);result.push(days.get(label)||{label,value:null,min:null,max:null,hours:0});}
  return result;
}
function historicalChartData(grouped,variable,mode){
  const daily=mode==='day',data=daily?fillDailyGaps(grouped):grouped;
  const average={label:daily?'Promedio diario':`${variable.short} (${variable.unit})`,data:data.map(p=>p.value),borderColor:variable.color,backgroundColor:daily?'transparent':variable.color+'12',borderWidth:2.5,fill:!daily,tension:daily?0:.22,spanGaps:false,pointRadius:data.length>80?0:2.5,pointHoverRadius:5};
  if(daily&&HEALTH_SCALES[variable.key]){average.pointBackgroundColor=context=>referenceColor(context.raw,variable.key);average.segment={borderColor:context=>referenceColor((context.p0.parsed.y+context.p1.parsed.y)/2,variable.key)};}
  const datasets=daily?[
    {label:'Mínimo diario',data:data.map(p=>p.min),borderColor:'transparent',pointRadius:0,fill:false,spanGaps:false},
    {label:'Rango diario (mín–máx)',data:data.map(p=>p.max),borderColor:'transparent',backgroundColor:'#007f851f',pointRadius:0,fill:'-1',spanGaps:false},average
  ]:[average];
  return {labels:data.map(p=>p.label),datasets};
}
function historicalTooltip(item){
  const data=item.chart.data,unit=item.chart.options.scales.y.title.text;
  if(data.datasets.length===3&&item.datasetIndex===1)return `Rango diario: ${format(data.datasets[0].data[item.dataIndex])}–${format(item.parsed.y)} ${unit}`;
  return `${item.dataset.label}: ${format(item.parsed.y)} ${unit}`;
}
function renderHealthTable() {
  $('health-ranges').innerHTML=HEALTH_CATEGORIES.map((c,i)=>`<tr><td><span class="range-dot" style="background:${c.color}"></span>${c.label}</td><td>${HEALTH_SCALES.pm25_ugm3.labels[i]}</td><td>${HEALTH_SCALES.pm10_ugm3.labels[i]}</td><td>${c.note}</td></tr>`).join('');
}
function mapSummary() {
  const latest=rows.findLast(row=>Number.isFinite(row.pm25_ugm3)&&row.pm25_ugm3>=0);
  const color=latest?referenceColor(latest.pm25_ugm3,'pm25_ugm3'):'#657a80';
  const readings=VARIABLES.map(v=>{
    const reading=rows.findLast(row=>Number.isFinite(row[v.key])&&(!v.key.endsWith('_ugm3')||row[v.key]>=0));
    return `<div class="map-reading"><div><b>${v.short}</b><span>${v.instrument}</span><small>${reading?dateFormat.format(new Date(reading.timestamp)):'Sin mediciones'}</small></div><strong>${format(reading?.[v.key])} <small>${v.unit}</small></strong></div>`;
  }).join('');
  const daily=['pm25_ugm3','pm10_ugm3'].map(key=>{
    const summary=dailyReference(rows,key),variable=VARIABLES.find(v=>v.key===key);
    return `<div class="map-daily-reading"><b>${variable.short}</b><span>${format(summary.value)} µg/m³ · ${summary.category?.label||'Datos insuficientes'}</span><small>${summary.day} · ${summary.hours}/18 horas mínimas con datos</small></div>`;
  }).join('');
  const stale=latest&&Date.now()-Date.parse(latest.timestamp)>config.data.staleAfterMinutes*60000;
  const html=`<section class="station-popup" style="--pm25-color:${color}"><header class="station-popup-header"><b>HiriPro V5 · Sensor 232</b><span>Ante Puerto Lirquén</span><strong>PM2.5: ${format(latest?.pm25_ugm3)} µg/m³</strong><small>${latest?dateFormat.format(new Date(latest.timestamp)):'Sin mediciones de PM2.5'}${stale?' · Lectura antigua':''}${config.data.mode==='demo'?' · SIMULADO':''}</small></header><div class="station-popup-body"><h3>Últimas lecturas disponibles</h3>${readings}<h3>Resumen diario de ayer</h3>${daily}<p class="station-popup-note">Color según la última lectura de PM2.5, con la misma escala visual del histórico: verde (0), amarillo (25), rojo (50) y tonos morados desde 75 µg/m³. Sin PM2.5 disponible: gris. Una lectura puntual no determina cumplimiento diario.</p><footer>${config.station.latitude}, ${config.station.longitude}</footer></div></section>`;
  return {color,html};
}
function mapIcon(color) {
  return L.divIcon({className:'station-map-pin',html:`<span style="--pm25-color:${color}">232</span>`,iconSize:[46,46],iconAnchor:[23,23],popupAnchor:[0,-24]});
}
function updateMapSummary() {
  if(!stationMarker)return;
  const summary=mapSummary();
  stationMarker.setIcon(mapIcon(summary.color));
  stationMarker.setPopupContent(summary.html);
}
function initMap() {
  if(stationMap){stationMap.invalidateSize();return;}
  if(typeof L==='undefined'){$('map-status').textContent='No se pudo cargar el mapa. Usa el enlace para abrir la ubicación.';return;}
  const {latitude,longitude}=config.station;
  stationMap=L.map('map',{scrollWheelZoom:false}).setView([latitude,longitude],15);
  const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(stationMap);
  tiles.on('tileerror',()=>{$('map-status').textContent='La cartografía no está disponible. Las coordenadas de la estación siguen indicadas y puedes abrir el mapa completo.';});
  const summary=mapSummary();
  stationMarker=L.marker([latitude,longitude],{icon:mapIcon(summary.color),title:'HiriPro V5 · Sensor 232: clic para ver todas las mediciones'}).addTo(stationMap).bindPopup(summary.html,{className:'station-summary-popup',maxWidth:320,minWidth:220,maxHeight:240});
}
const dailyBandsPlugin={id:'dailyBands',afterDraw(instance,_args,options){
  if(!options?.key||!instance.chartArea)return;const scale=HEALTH_SCALES[options.key],{left,right,top,bottom}=instance.chartArea,y=instance.scales.y.getPixelForValue(scale.reference);if(y<top||y>bottom)return;
  const ctx=instance.ctx;ctx.save();ctx.setLineDash([6,5]);ctx.strokeStyle='#7b567f';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.setLineDash([]);ctx.font='10px Segoe UI';ctx.fillStyle='#704575';ctx.fillText(`Referencia chilena diaria: ${scale.reference}`,left+8,Math.max(top+12,y-7));ctx.restore();
}};
const format = value => value === null || value === undefined ? '—' : value.toLocaleString('es-CL', {maximumFractionDigits:1});
const dateFormat = new Intl.DateTimeFormat('es-CL', {timeZone:'America/Santiago', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Santiago', year:'numeric', month:'2-digit', day:'2-digit'});
function localDay(timestamp) { const p = Object.fromEntries(dayFormat.formatToParts(new Date(timestamp)).map(x => [x.type,x.value])); return `${p.year}-${p.month}-${p.day}`; }
function localHour(timestamp) { return `${localDay(timestamp)} ${new Intl.DateTimeFormat('en-GB',{timeZone:'America/Santiago',hour:'2-digit',hourCycle:'h23'}).format(new Date(timestamp))}`; }
function number(value) { if (value === undefined || value === null || String(value).trim() === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
// Quoted CSV fields, escaped quotes and either LF or CRLF are accepted.
function parseCSV(text) {
  const records = []; let record = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i=0;i<text.length;i++) { const c=text[i]; if(c==='"') { if(quoted && text[i+1]==='"') {field+='"';i++;} else quoted=!quoted; } else if(c===',' && !quoted) {record.push(field);field='';} else if((c==='\n'||c==='\r')&&!quoted) { if(c==='\r'&&text[i+1]==='\n')i++; record.push(field); if(record.some(x=>x.trim())) records.push(record); record=[];field='';} else field+=c; }
  if(quoted) throw Error('CSV con comillas sin cerrar.');
  if(field || record.length){record.push(field);records.push(record);}
  const headers=records.shift() || [];
  if(!['timestamp','sensor_id',...VARIABLES.map(v=>v.key)].every(key=>headers.includes(key))) throw Error('El CSV no cumple el formato HiriPro.');
  return records.map(record=>Object.fromEntries(headers.map((key,i)=>[key,record[i]])));
}
function normalize(raw) {
  const byTime = new Map();
  for(const row of raw) {
    if(Number(row.sensor_id)!==232) continue;
    if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.timestamp)) throw Error('Las fechas deben incluir zona horaria.');
    const time = new Date(row.timestamp).getTime();
    if(!Number.isFinite(time)) throw Error('Fecha de medición inválida.');
    byTime.set(time, {timestamp:new Date(time).toISOString(), sensor_id:232, ...Object.fromEntries(VARIABLES.map(v=>[v.key,number(row[v.key])]))});
  }
  return [...byTime.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
}
function demoRows() {
  const end=Math.floor(Date.now()/3600000)*3600000;
  return Array.from({length:721},(_,i)=>{ const cycle=Math.sin(i*.26), slow=Math.sin(i*.055), pulse=Math.max(0,Math.sin(i*.13))**8; const pm=14+5*cycle+3*slow+22*pulse; const round=n=>Math.round(n*10)/10;
    return {timestamp:new Date(end-(720-i)*3600000).toISOString(),sensor_id:232,pm25_ugm3:round(pm),pm1_ugm3:round(pm*.68),pm10_ugm3:round(pm*1.39+4),pms_temperature_c:round(17+3*cycle+slow),pms_humidity_pct:round(68-9*cycle+3*slow),sht_temperature_c:round(16.4+2.9*cycle+slow),sht_humidity_pct:round(70-8.5*cycle+3*slow),signal:Math.round(22+3*slow+cycle)};
  });
}
function sparkline(values,color) {
  const valid=values.filter(v=>v!==null); if(valid.length<2) return '';
  const min=Math.min(...valid), max=Math.max(...valid), span=max-min || 1;
  const points=valid.map((v,i)=>`${(i/(valid.length-1)*280).toFixed(1)},${(30-(v-min)/span*26).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 280 34" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderCards() {
  const cards=VARIABLES.map((v,i)=>{
    const latest=rows.findLast(row=>row[v.key]!==null); const stamp=latest?dateFormat.format(new Date(latest.timestamp)):'Sin mediciones';
    const daily=i<3?dailyReference(rows,v.key):null;
    const health=i<3?`<span class="metric-health" style="--health-color:${daily.category?.color||'#657a80'}">${HEALTH_SCALES[v.key]?`Ayer: ${daily.category?.label||'datos insuficientes'}`:'PM 1.0 · sin escala AQI'}</span>`:'';
    return `<button class="metric-card" data-variable="${v.key}" aria-label="Ver histórico de ${v.label}"><div class="metric-top"><span>${v.instrument} / ÚLTIMA LECTURA</span><span class="metric-icon">${v.icon}</span></div><h3>${v.short}</h3><div class="metric-value">${format(latest?.[v.key])}<small>${v.unit}</small></div>${health}${i<3?sparkline(rows.slice(-24).map(r=>r[v.key]),v.color):''}<div class="metric-bottom"><span>${stamp}</span><span>↗</span></div></button>`;
  });
  $('primary-metrics').innerHTML=cards.slice(0,3).join(''); $('secondary-metrics').innerHTML=cards.slice(3).join('');
  document.querySelectorAll('[data-variable]').forEach(button=>button.addEventListener('click',()=>{ $('variable').value=button.dataset.variable; renderHistory(); $('history').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); }));
}
function selection() {
  const period=$('period').value, key=$('variable').value;
  let chosen=rows;
  if(period==='custom') { const from=$('date-from').value,to=$('date-to').value; if(!from||!to||from>to) throw Error('Selecciona un rango válido: la fecha inicial debe ser anterior o igual a la final.'); chosen=rows.filter(r=>{const d=localDay(r.timestamp);return d>=from&&d<=to;}); }
  else if(period!=='all') {const days={'24h':1,'7d':7,'30d':30}[period]; const start=Date.now()-days*86400000; chosen=rows.filter(r=>new Date(r.timestamp).getTime()>=start);}
  return {chosen,points:chosen.filter(r=>r[key]!==null),variable:VARIABLES.find(v=>v.key===key)};
}
function aggregate(points,key) {
  const mode=$('aggregation').value; if(mode==='raw') return points.map(r=>({label:dateFormat.format(new Date(r.timestamp)),value:r[key]}));
  if(mode==='day')return dailyGroups(points,key);
  const groups=new Map(); for(const row of points){const label=mode==='day'?localDay(row.timestamp):localHour(row.timestamp);const g=groups.get(label)||{sum:0,count:0};g.sum+=row[key];g.count++;groups.set(label,g);}
  return [...groups].map(([label,g])=>({label,value:g.sum/g.count}));
}
function renderHistory() {
  document.querySelectorAll('.date-control').forEach(el=>el.hidden=$('period').value!=='custom');
  let selectionData;
  try {selectionData=selection();$('range-error').hidden=true;} catch(error){$('range-error').textContent=error.message;$('range-error').hidden=false;selectionData={chosen:[],points:[],variable:VARIABLES.find(v=>v.key===$('variable').value)};}
  const {chosen,points,variable:v}=selectionData, values=points.map(r=>r[v.key]);
  $('chart-title').textContent=v.label; $('chart-subtitle').textContent=`${v.instrument} · ${v.unit}`; $('table-variable').textContent=`${v.short} (${v.unit})`;
  $('average').textContent=format(values.length?values.reduce((a,b)=>a+b,0)/values.length:null); $('minimum').textContent=format(values.length?values.reduce((a,b)=>Math.min(a,b)):null); $('maximum').textContent=format(values.length?values.reduce((a,b)=>Math.max(a,b)):null);
  const grouped=aggregate(points,v.key),mode=$('aggregation').value;
  renderHealthLegend(v.key);
  renderHistorySummary(v,points);
  $('record-count').textContent=`${points.length.toLocaleString('es-CL')} lecturas válidas de ${chosen.length.toLocaleString('es-CL')} registros · ${grouped.length} puntos en el gráfico`;
  $('chart-note').textContent=`${{raw:'Mediciones originales',hour:'Promedios por hora',day:'Línea: promedio diario con igual peso por hora. Banda: mínimo–máximo observado. Los días de borde pueden ser parciales; el día en curso es provisional.'}[mode]} · hora de Chile${config.data.mode==='demo'?' · datos simulados':''}`;
  $('chart-empty').hidden=points.length>0;
  $('download-selection').disabled=!chosen.length; $('download-all').disabled=!rows.length;
  const body=$('readings-table');body.replaceChildren();
  for(const row of chosen.slice(-10).reverse()) {const tr=document.createElement('tr');for(const text of [dateFormat.format(new Date(row.timestamp)),format(row[v.key]),v.instrument,'232']) {const td=document.createElement('td');td.textContent=text;tr.append(td);}body.append(tr);}
  if(!chosen.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='Sin registros para esta selección.';tr.append(td);body.append(tr);}
  const chartData=historicalChartData(grouped,v,mode);
  const bandsKey=mode==='day'&&HEALTH_SCALES[v.key]?v.key:null;
  if(chart){chart.data=chartData;chart.options.scales.y.title.text=v.unit;chart.options.plugins.legend.display=mode==='day';chart.options.plugins.dailyBands={key:bandsKey};chart.options.scales.y.suggestedMin=bandsKey?0:undefined;chart.options.scales.y.suggestedMax=bandsKey?HEALTH_SCALES[v.key].reference*1.1:undefined;chart.update();}
  else chart=new Chart($('chart'),{type:'line',data:chartData,plugins:[dailyBandsPlugin],options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{dailyBands:{key:bandsKey},legend:{display:mode==='day',labels:{filter:item=>item.datasetIndex!==0,font:{size:10},color:'#657a80'}},tooltip:{padding:12,backgroundColor:'#163b46',filter:item=>item.chart.data.datasets.length===1||item.datasetIndex!==0,callbacks:{label:historicalTooltip}}},scales:{x:{grid:{display:false},ticks:{maxTicksLimit:7,maxRotation:0,font:{size:10},color:'#657a80'}},y:{suggestedMin:bandsKey?0:undefined,suggestedMax:bandsKey?HEALTH_SCALES[v.key].reference*1.1:undefined,title:{display:true,text:v.unit,font:{size:10}},grid:{color:'#edf2f0'},border:{display:false},ticks:{font:{size:10},color:'#657a80'}}}}});
}
async function loadData() {
  if(loading||!authenticated)return;loading=true;$('refresh').disabled=true;
  try {let next;if(config.data.mode==='demo')next=demoRows();else {const response=await fetch(config.data.csvUrl,{cache:'no-store'});if(!response.ok)throw Error(`HTTP ${response.status}`);next=normalize(parseCSV(await response.text()));}rows=next;
    const latest=rows.at(-1);$('demo-badge').hidden=config.data.mode!=='demo';$('updated').textContent=latest?dateFormat.format(new Date(latest.timestamp)):'Sin mediciones';
    const stale=latest&&Date.now()-new Date(latest.timestamp).getTime()>config.data.staleAfterMinutes*60000;
    $('status-dot').className=`status-dot ${config.data.mode==='demo'?'demo':!latest||stale?'stale':'live'}`;
    $('data-status').textContent=config.data.mode==='demo'?'Vista de demostración':!latest?'Esperando mediciones':stale?'Sin lecturas recientes':'Mediciones actualizadas';
    $('data-notice').textContent=config.data.mode==='demo'?'Datos simulados para presentar el servicio. No corresponden a mediciones reales del puerto.':!latest?'Todavía no hay datos publicados para el sensor 232.':`El portal revisa nuevas publicaciones cada ${config.data.refreshMinutes} minutos.${stale?' La última lectura está fuera del intervalo esperado.':''}`;
    if(latest&&!$('date-from').value){$('date-to').value=localDay(latest.timestamp);$('date-from').value=localDay(new Date(new Date(latest.timestamp).getTime()-7*86400000).toISOString());}
    updateMapSummary();renderCards();renderDailySummary();renderHistory();
  }catch(error){$('data-status').textContent='No se pudo actualizar';$('status-dot').className='status-dot stale';$('data-notice').textContent=`No fue posible cargar los datos. ${rows.length?'Se mantiene la última descarga disponible.':'Revisa la publicación del archivo de la estación.'} Detalle: ${error.message}`;updateMapSummary();renderCards();renderDailySummary();renderHistory();}
  finally{loading=false;$('refresh').disabled=false;}
}
function csvCell(value){const text=String(value??'');return /[",\n\r]/.test(text)?`"${text.replaceAll('"','""')}"`:text;}
function downloadCSV(selectedRows,suffix) {
  const keys=['timestamp','sensor_id',...VARIABLES.map(v=>v.key),'data_origin'];
  const csv=[keys.join(','),...selectedRows.map(row=>keys.map(key=>csvCell(key==='data_origin'?(config.data.mode==='demo'?'SIMULADO':'MEDIDO'):row[key])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`hiripro-232-${config.data.mode==='demo'?'DEMO-':''}${suffix}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function init(){
  $('login-form').querySelector('[type=submit]').disabled=true;
  try{const response=await fetch('config/portal.json',{cache:'no-store'});if(!response.ok)throw Error('No se encontró config/portal.json.');config=await response.json();if(config.station?.id!==232||!Number.isFinite(config.station.latitude)||!Number.isFinite(config.station.longitude)||!config.access?.username||!config.access?.password||!['demo','csv'].includes(config.data?.mode)||!config.data.csvUrl||!(config.data.refreshMinutes>0)||!(config.data.staleAfterMinutes>0))throw Error('Configuración del portal inválida.');$('login-form').querySelector('[type=submit]').disabled=false;}
  catch(error){$('config-error').textContent=`No se pudo preparar el portal: ${error.message} Abre el sitio desde un servidor HTTP.`;$('config-error').hidden=false;return;}
  $('variable').innerHTML=VARIABLES.map(v=>`<option value="${v.key}">${v.instrument} · ${v.label}</option>`).join('');
  renderHealthTable();
  $('login-form').addEventListener('submit',event=>{event.preventDefault();if($('username').value.trim()!==config.access.username||$('password').value!==config.access.password){$('login-error').textContent='Usuario o contraseña incorrectos.';$('login-error').hidden=false;return;}authenticated=true;$('login-error').hidden=true;$('password').value='';$('login-view').hidden=true;$('dashboard-view').hidden=false;window.scrollTo(0,0);initMap();$('logout').focus({preventScroll:true});loadData();refreshTimer=setInterval(loadData,config.data.refreshMinutes*60000);});
  $('logout').addEventListener('click',()=>{authenticated=false;clearInterval(refreshTimer);$('dashboard-view').hidden=true;$('login-view').hidden=false;$('password').value='';$('username').focus();window.scrollTo(0,0);});
  $('toggle-password').addEventListener('click',()=>{const show=$('password').type==='password';$('password').type=show?'text':'password';$('toggle-password').textContent=show?'Ocultar':'Ver';$('toggle-password').setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña');$('toggle-password').setAttribute('aria-pressed',String(show));});
  ['variable','period','aggregation','date-from','date-to'].forEach(id=>$(id).addEventListener('change',renderHistory));$('refresh').addEventListener('click',loadData);
  $('download-selection').addEventListener('click',()=>{try{downloadCSV(selection().chosen,'seleccion');}catch(error){$('range-error').textContent=error.message;$('range-error').hidden=false;}});$('download-all').addEventListener('click',()=>downloadCSV(rows,'historico'));
  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active',a.hash===`#${entry.target.id}`));},{rootMargin:'-15% 0px -55% 0px'});['overview','history','location','station'].forEach(id=>observer.observe($(id)));
}
init();
