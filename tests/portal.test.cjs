const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function context(){
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:''});return elements.get(id);}};
  const ctx=vm.createContext({document,Intl,Date,Number,Map,Error,Blob,URL,console,setTimeout});
  vm.runInContext(fs.readFileSync('app.js','utf8').replace(/\ninit\(\);\s*$/,''),ctx);
  return {run:code=>vm.runInContext(code,ctx),ctx,elements,document};
}
const row={timestamp:'2026-10-02T13:00:00Z',sensor_id:232,pm25_ugm3:12,pm1_ugm3:8,pm10_ugm3:20,pms_temperature_c:17,pms_humidity_pct:60,sht_temperature_c:16,sht_humidity_pct:61,signal:22};
test('CSV handles BOM, quoted fields, CRLF, blanks and zero measurements',()=>{
 const c=context();c.ctx.input='\uFEFF'+Object.keys(row).join(',')+'\r\n'+Object.values({...row,pm25_ugm3:0,pms_temperature_c:''}).map(v=>'"'+v+'"').join(',')+'\r\n';
 const result=c.run('normalize(parseCSV(input))');assert.equal(result[0].pm25_ugm3,0);assert.equal(result[0].pms_temperature_c,null);
});
test('only 232 is displayed, equivalent timestamps deduplicate and rows sort',()=>{
 const c=context();c.ctx.input=[row,{...row,sensor_id:31},{...row,timestamp:'2026-10-02T10:00:00-03:00',pm25_ugm3:14},{...row,timestamp:'2026-10-01T13:00:00Z'}];
 const result=c.run('normalize(input)');assert.equal(result.length,2);assert.equal(result[1].pm25_ugm3,14);assert.equal(result[0].timestamp,'2026-10-01T13:00:00.000Z');
});
test('malformed CSV and dates without timezone fail visibly',()=>{
 const c=context();assert.throws(()=>c.run('parseCSV("wrong,columns\\n1,2")'),/formato/);c.ctx.input=[{...row,timestamp:'2026-10-02T13:00:00'}];assert.throws(()=>c.run('normalize(input)'),/zona horaria/);
});
test('public API latest row maps the eight variables and Chile wall time',()=>{
 const c=context(),api={data:{tableData:[{codigo_interno:'HIRIPRO-V5',fecha:'2026-10-02T14:45:20',
  'PMS5003 [Material particulado PM 2.5 (µg/m³)]':'12','PMS5003 [Material particulado PM 1.0 (µg/m³)]':'8','PMS5003 [Material particulado PM 10 (µg/m³)]':'20',
  'PMS5003 [Grados celcius (°C)]':'17','PMS5003 [Humedad (%)]':'60','SHT40 [Grados celcius (°C)]':'16','SHT40 [Humedad (%)]':'61','SIM7600G [Intensidad señal telefónica (Adimensional)]':'22'}]}};
 c.ctx.input=api;const result=c.run('apiLatestRow(input)');assert.equal(result.timestamp,'2026-10-02T17:45:20.000Z');assert.equal(result.pm25_ugm3,12);assert.equal(result.signal,22);
});
test('demo contains all eight variables for 232 and no other sensors',()=>{
 const c=context();const result=c.run('demoRows()');assert.equal(result.length,721);assert.ok(result.every(r=>r.sensor_id===232&&Object.keys(r).length===10));
});
test('quick periods use current time, not the most recent old reading',()=>{
 const c=context();c.ctx.input=[{...row,timestamp:'2020-01-01T00:00:00Z'}];c.run('rows=normalize(input)');c.document.getElementById('variable').value='pm25_ugm3';c.document.getElementById('period').value='24h';assert.equal(c.run('selection().chosen.length'),0);
});
test('custom date selection includes Chile local day boundaries',()=>{
 const c=context();c.ctx.input=[{...row,timestamp:'2026-10-02T01:00:00Z'},{...row,timestamp:'2026-10-02T13:00:00Z'}];c.run('rows=normalize(input)');c.document.getElementById('variable').value='pm25_ugm3';c.document.getElementById('period').value='custom';c.document.getElementById('date-from').value='2026-10-01';c.document.getElementById('date-to').value='2026-10-01';assert.equal(c.run('selection().chosen.length'),1);
 c.document.getElementById('date-from').value='2026-10-03';assert.throws(()=>c.run('selection()'),/rango válido/);
});
test('hour/day aggregation computes measured means and keeps nulls out',()=>{
 const c=context();c.ctx.input=[row,{...row,timestamp:'2026-10-02T13:30:00Z',pm25_ugm3:20}];c.run('rows=normalize(input)');c.document.getElementById('aggregation').value='hour';const grouped=c.run('aggregate(rows,"pm25_ugm3")');assert.equal(grouped.length,1);assert.equal(grouped[0].value,16);
});
test('CSV downloads contain eight variables and mark simulated origin',async()=>{
 const c=context();let savedBlob,clicked=false,anchor; c.ctx.URL={createObjectURL(blob){savedBlob=blob;return 'blob:test';},revokeObjectURL(){}};c.ctx.setTimeout=()=>{};c.ctx.document.body={append(){}};c.ctx.document.createElement=()=>anchor={click(){clicked=true;},remove(){}};c.ctx.input=[row];c.run('config={data:{mode:"demo"}};downloadCSV(input,"historico")');
 assert.ok(clicked);assert.match(anchor.download,/DEMO/);const csv=await savedBlob.text();assert.match(csv,/signal,data_origin/);assert.match(csv,/SIMULADO/);assert.equal(csv.trim().split('\n').length,2);
});
test('health categories use EPA 2024 concentration thresholds and truncation',()=>{
 const c=context();
 for(const [value,expected] of [[9.09,'Buena'],[9.1,'Moderada'],[35.49,'Moderada'],[35.5,'Dañina para grupos sensibles'],[55.5,'Dañina'],[125.5,'Muy dañina'],[225.5,'Peligrosa']])assert.equal(c.run(`healthCategory(${value},'pm25_ugm3').label`),expected);
 assert.equal(c.run("healthCategory(54.99,'pm10_ugm3').label"),'Buena');assert.equal(c.run("healthCategory(55,'pm10_ugm3').label"),'Moderada');
 assert.equal(c.run("healthCategory(425,'pm10_ugm3').label"),'Peligrosa');
 assert.equal(c.run("healthCategory(12,'pm1_ugm3')"),null);assert.equal(c.run("healthCategory(-1,'pm25_ugm3')"),null);
});
test('daily health reference requires distinct hours and does not classify current day',()=>{
 const c=context();c.ctx.now=Date.parse('2026-10-02T15:00:00Z');
 c.ctx.input=Array.from({length:17},(_,i)=>({...row,timestamp:new Date(Date.parse('2026-10-01T03:00:00Z')+i*3600000).toISOString()}));
 assert.equal(c.run("dailyReference(input,'pm25_ugm3',now).category"),null);
 c.ctx.input.push({...row,timestamp:'2026-10-01T20:00:00Z'});
 let result=c.run("dailyReference(input,'pm25_ugm3',now)");assert.equal(result.hours,18);assert.equal(result.category.label,'Moderada');assert.equal(result.day,'2026-10-01');
 c.ctx.input=Array.from({length:24},(_,i)=>({...row,timestamp:new Date(Date.parse('2026-10-02T03:00:00Z')+i*60000).toISOString()}));
 assert.equal(c.run("dailyReference(input,'pm25_ugm3',now).hours"),0);
 c.ctx.input=Array.from({length:60},(_,i)=>({...row,timestamp:new Date(Date.parse('2026-10-01T03:00:00Z')+i*60000).toISOString()}));
 assert.equal(c.run("dailyReference(input,'pm25_ugm3',now).hours"),1);assert.equal(c.run("dailyReference(input,'pm25_ugm3',now).category"),null);
});
test('hourly means have equal weight and daily aggregation preserves negative temperature',()=>{
 const c=context();c.ctx.input=[{...row,timestamp:'2026-10-01T13:00:00Z',pm25_ugm3:10,pms_temperature_c:-2},...Array.from({length:10},(_,i)=>({...row,timestamp:`2026-10-01T14:${String(i).padStart(2,'0')}:00Z`,pm25_ugm3:30,pms_temperature_c:-4}))];
 assert.equal(c.run("dailyGroups(input,'pm25_ugm3')[0].value"),20);assert.equal(c.run("dailyGroups(input,'pms_temperature_c')[0].value"),-3);
});
test('daily range preserves observed extrema and gaps are not zeros',()=>{
 const c=context();c.ctx.input=[{...row,timestamp:'2026-10-01T13:00:00Z',pm25_ugm3:2},{...row,timestamp:'2026-10-01T13:30:00Z',pm25_ugm3:10},{...row,timestamp:'2026-10-01T14:00:00Z',pm25_ugm3:20},{...row,timestamp:'2026-10-03T13:00:00Z',pm25_ugm3:8}];
 const result=c.run("historicalChartData(dailyGroups(input,'pm25_ugm3'),VARIABLES[0],'day')");
 assert.equal(result.labels.length,3);assert.equal(result.labels[1],'2026-10-02');
 assert.equal(result.datasets[0].data[0],2);assert.equal(result.datasets[1].data[0],20);assert.equal(result.datasets[2].data[0],13);
 assert.ok(result.datasets.every(d=>d.data[1]===null));assert.equal(result.datasets[1].fill,'-1');assert.equal(result.datasets[2].spanGaps,false);
});
test('visual reference scale marks the Chile threshold and does not classify other variables',()=>{
 const c=context();assert.equal(c.run("referenceColor(50,'pm25_ugm3')"),'#dc493a');assert.equal(c.run("referenceColor(130,'pm10_ugm3')"),'#dc493a');assert.equal(c.run("referenceTicks('pm1_ugm3')"),null);
});
test('latest hourly reading averages only the last hour with valid values',()=>{
 const c=context();c.ctx.input=[{...row,timestamp:'2026-10-02T12:59:00Z',pm25_ugm3:100},{...row,timestamp:'2026-10-02T13:00:00Z',pm25_ugm3:2},{...row,timestamp:'2026-10-02T13:30:00Z',pm25_ugm3:10},{...row,timestamp:'2026-10-02T14:00:00Z',pm25_ugm3:null}];assert.equal(c.run("latestHourly(input,'pm25_ugm3').value"),6);
});
test('public site omits map and exact georeference',()=>{
 const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('app.js','utf8'),config=JSON.parse(fs.readFileSync('config/portal.json','utf8'));
 assert.doesNotMatch(html,/leaflet|OpenStreetMap|id="map"|-36\.723383|-72\.980878/i);
 assert.doesNotMatch(app,/stationMap|stationMarker|initMap|mapSummary|latitude|longitude/);
 assert.equal(config.station.location,'Región del Biobío');assert.equal('latitude' in config.station,false);assert.equal('longitude' in config.station,false);
});
