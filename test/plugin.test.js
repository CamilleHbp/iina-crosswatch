const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const media = require('../media');
const { Tracker } = require('../tracker');
const { createClient, configuration } = require('../client');
const { createTransport } = require('../transport');

test('parses release names, specials, episode numbers, and private stream queries', () => {
  assert.deepEqual(media.parseFilename('/Videos/The.Matrix.1999.1080p.mkv'), {
    title:'The Matrix', year:1999, type:'movie', season:null, episode:null, multi:false, imdb:null, filename:'The.Matrix.1999.1080p'
  });
  const episode = media.parseFilename('Severance.S00E02.1080p.mkv');
  assert.equal(episode.title, 'Severance'); assert.equal(episode.season, 0); assert.equal(episode.episode, 2);
  assert.equal(media.parseFilename('Severance.1x03.mkv').episode, 3);
  assert.equal(media.parseFilename('Show.S01E01E02.mkv').multi, true);
  assert.equal(media.parseFilename('https://example.com/Movie.2000.mp4?token=SECRET').filename.includes('SECRET'), false);
});

test('automatic matching rejects ambiguity, missing movie years and multi-episode files', () => {
  const item = {type:'movie', title:'The Matrix', year:1999, tmdb:603};
  assert.equal(media.chooseMatch(media.parseFilename('The.Matrix.1999.mkv'), [item]), item);
  assert.equal(media.chooseMatch(media.parseFilename('The.Matrix.mkv'), [item]), null);
  assert.equal(media.chooseMatch(media.parseFilename('The.Matrix.1999.mkv'), [item,item]), null);
  assert.equal(media.chooseMatch(media.parseFilename('The.Matrix.2000.mkv'), [item]), null);
});

test('episode payload puts series IDs in show_ids and validates episode selection', () => {
  const m = media.makeMedia({type:'show',title:'Severance',tmdb:95396},0,2);
  const r = media.record(m,3600);
  assert.deepEqual(r.ids, {});
  assert.deepEqual(r.provider_metadata.show_ids, {tmdb:'95396'});
  assert.equal(r.media_type, 'episode'); assert.equal(r.season,0); assert.equal(r.episode,2);
  assert.throws(()=>media.makeMedia({type:'show',tmdb:1},'',1));
  assert.throws(()=>media.makeMedia({type:'show',tmdb:1},1,0));
  assert.throws(()=>media.makeMedia({type:'movie',tmdb:'1;rm'}));
});

function tracker() { const t = new Tracker({threshold:80,minimum:60}); t.select(media.makeMedia({type:'movie',tmdb:603,title:'The Matrix'})); return t; }
function sample(t,position,now,paused=false,force=false) { return t.sample({position,duration:100,now,paused,speed:1},force); }
test('throttles progress, flushes pause, records history once and stops progress after completion', () => {
  const t=tracker(); let jobs=[];
  for(let n=0;n<=90;n++) { const job=sample(t,n,1000+n); if(job)jobs.push(job); }
  assert.equal(jobs.filter(x=>x.kind==='history').length,1);
  assert.equal(jobs.at(-1).kind,'history');
  assert.equal(jobs.at(-1).watched_at,new Date(1080*1000).toISOString());
  assert.equal(sample(t,90,1100,true,true),null);
  const p=tracker();sample(p,1,1000);assert.equal(sample(p,2,1001),null);
  assert.equal(sample(p,2,1002,true).kind,'progress');
});
test('seeking to credits, buffering, and system sleep do not satisfy minimum watched time', () => {
  const t=tracker(); sample(t,0,1000); sample(t,90,1001); assert.equal(t.completed,false);
  for(let n=0;n<60;n++)sample(t,90,1002+n,true);
  assert.equal(t.completed,false); assert.equal(t.watchedSeconds,0);
  const asleep=tracker();sample(asleep,0,1000);sample(asleep,90,2000);
  assert.equal(asleep.completed,false);
});
test('invalid playback values are ignored', () => {
  const t=tracker();assert.equal(t.sample({position:1,duration:NaN,now:1}),null);
  assert.equal(t.sample({position:NaN,duration:100,now:1}),null);
});

test('client uses only native CrossWatch endpoints and checks application-level success', async () => {
  const calls=[]; const config={base:'https://example.com',token:'test-token',instance:'default'};
  const http={post:async(url,options)=>{calls.push({url,options});return{statusCode:200,data:{ok:true}};},get:async()=>({statusCode:200,text:'{"ok":true,"results":[]}'})};
  const c=createClient(http,config);
  await c.send({kind:'history',record:{media_type:'movie'},watched_at:'2026-10-31T20:00:00Z'});
  assert.equal(calls[0].url,'https://example.com/api/playback_progress/actions/mark_watched');
  assert.equal(calls[0].options.data.provider,'crosswatch');
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
  const bad=createClient({post:async()=>({statusCode:200,data:{ok:false}})},config);
  await assert.rejects(bad.send({kind:'progress'}),/request failed/);
  const denied=createClient({post:async()=>({statusCode:401,data:{ok:false}})},config);
  await assert.rejects(denied.send({kind:'progress'}),/token/);
});
test('configuration refuses insecure URLs and header injection', () => {
  for(const url of ['http://example.com','https://user:pass@example.com','https://example.com?x=y']) {
    assert.throws(()=>configuration({get:k=>k==='server_url'?url:'token'}));
  }
  assert.throws(()=>configuration({get:k=>k==='server_url'?'https://example.com':'token\r\nx:bad'}));
});
test('transport sends JSON and keeps tokens out of process arguments; removes temporary files', async () => {
  const written={},deleted=[],commands=[];
  const r={file:{write:(p,v)=>written[p]=v,delete:p=>deleted.push(p)},utils:{exec:async(bin,args)=>{
    commands.push({bin,args});
    if(bin.endsWith('mktemp'))return{status:0,stdout:'/var/folders/xx/test/T/iina-crosswatch.abc123\n'};
    if(bin.endsWith('curl'))return{status:0,stdout:'{"ok":true}\n__CW_STATUS__:200'};
    return{status:0,stdout:''};
  }}};
  const result=await createTransport(r).post('https://example.com/api/test',{headers:{Authorization:'Bearer TOPSECRET'},data:{nested:{a:1}}});
  assert.equal(result.statusCode,200);
  assert.equal(result.text,'{"ok":true}');
  assert.ok(!JSON.stringify(commands).includes('TOPSECRET'));
  assert.ok(Object.values(written).includes('{"nested":{"a":1}}'));
  assert.equal(deleted.length,2);
  assert.equal(commands.at(-1).bin,'/bin/rmdir');
});

test('IINA entry handles title lookup, durable failures, stop rollover and restart retries', async () => {
  let now=1000000; const prefs={server_url:'https://example.com',api_token:'test-token'};
  const handlers={},messages={},timers=[],requests=[];let fail=true;let syncs=0;
  const values={path:'/video/The.Matrix.1999.mkv',filename:'The.Matrix.1999.mkv','media-title':'The.Matrix.1999.mkv',duration:100,'time-pos':10,pause:false,speed:1};
  const fakeTransport={get:async()=>({statusCode:200,data:{ok:true,results:[{type:'movie',tmdb:603,title:'The Matrix',year:1999}]}}),post:async(url,opts)=>{requests.push({url,opts});if(fail)throw new Error('offline');return{statusCode:200,data:{ok:true}};}};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
  function boot(){
    const runtime={preferences:{get:k=>prefs[k],set:(k,v)=>prefs[k]=v,sync:()=>syncs++},
      mpv:{getNumber:k=>values[k],getString:k=>values[k],getFlag:k=>values[k]},
      sidebar:{onMessage:(k,v)=>messages[k]=v,postMessage:()=>{},loadFile:()=>{Object.keys(messages).forEach(k=>delete messages[k]);},show:()=>{}},
      menu:{addItem:()=>{},item:()=>{}},event:{on:(k,v)=>handlers[k]=v},console:{log:()=>{},warn:()=>{}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),{
      iina:runtime,Date:Clock,setInterval:fn=>timers.push(fn),require:p=>p==='./transport.js'?{createTransport:()=>fakeTransport}:require('../'+p.slice(2))
    });
  }
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  boot();assert.equal(Object.keys(messages).length,0);handlers['iina.window-loaded']();assert.ok(messages.check);handlers['iina.file-loaded']();await flush();await flush();
  assert.equal(requests.length,1);assert.ok(Object.keys(JSON.parse(prefs.pending)).length);assert.ok(syncs>0);
  values['time-pos']=0;handlers['mpv.end-file']();await flush();
  const pending=Object.values(JSON.parse(prefs.pending));assert.equal(pending[0].progress,10);
  fail=false;boot();timers.at(-1)();await flush();await flush();
  assert.equal(Object.keys(JSON.parse(prefs.pending)).length,0);
  assert.ok(requests.every(x=>x.url.includes('/api/playback_progress/')));
});
