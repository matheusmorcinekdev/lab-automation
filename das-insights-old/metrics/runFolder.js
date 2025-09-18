#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
// accept both spellings: optimised / optimized
const FILE_RE = /^(\d{2})-([a-z]{3})-(\d{4})-das-2-0-bidder-selection-optimi[sz]ed\.json$/i;

function parseDateFromName(name) {
  const m = name.match(FILE_RE);
  if (!m) return null;
  const [_, dd, monStr, yyyy] = m;
  const mm = MON[monStr.toLowerCase()];
  if (!mm) return null;
  return `${yyyy}-${String(mm).padStart(2,'0')}-${dd}`;
}
function isoToDate(iso){ const [y,m,d]=iso.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); }
function daysDiff(aIso,bIso){ return Math.round((isoToDate(aIso)-isoToDate(bIso))/86400000); }
function sha16(s){ return crypto.createHash('sha256').update(s,'utf8').digest('hex').slice(0,16); }
function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function writeJson(p,o){ fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,JSON.stringify(o,null,2)); console.log('Wrote',p); }
function asCohortKey(c,d,dev){ return `${c}|${d}|${dev}`; }

function gatherBiddersFromNode(node,out){
  if (!node || typeof node!=='object') return;
  if (Array.isArray(node)){ for(const it of node) gatherBiddersFromNode(it,out); return; }
  if (Array.isArray(node.bidders)){
    for (const b of node.bidders){
      if (b==null) continue;
      if (typeof b==='string') out.push({id:b});
      else {
        const id=String(b.id||b.bidder||b.name||''); if (!id) continue;
        out.push({ id, timeout:b.timeout??null, weight:b.weight??null, floor:b.floor??null, dealIds:b.dealIds??null });
      }
    }
  }
  for (const k of Object.keys(node)){ if (k!=='bidders') gatherBiddersFromNode(node[k],out); }
}

function extractFromConfig(cfg){
  const root=cfg?.defaultConfig; if (!root||typeof root!=='object') throw new Error('missing defaultConfig');
  const idsList=new Map(), configSig=new Map();
  for (const country of Object.keys(root)){
    const domains=root[country]; if (!domains) continue;
    for (const domain of Object.keys(domains)){
      const devices=domains[domain]; if (!devices) continue;
      for (const device of Object.keys(devices)){
        const cohort=asCohortKey(country,domain,device);
        const bidders=[]; gatherBiddersFromNode(devices[device],bidders);
        const ids=[...new Set(bidders.map(b=>String(b.id)))].filter(Boolean).sort();
        idsList.set(cohort, ids);
        const norm=bidders.map(b=>({id:String(b.id),timeout:b.timeout??null,weight:b.weight??null,floor:b.floor??null,dealIds:b.dealIds??null}))
                          .sort((a,b)=>a.id.localeCompare(b.id));
        configSig.set(cohort, sha16(JSON.stringify(norm)));
      }
    }
  }
  return { idsList, configSig };
}

function summarizeDaily({idsList,configSig}){
  const cohorts=[...idsList.keys()];
  const setKeys=new Set(), cfgKeys=new Set();
  for (const c of cohorts){
    setKeys.add(sha16(JSON.stringify(idsList.get(c))));
    cfgKeys.add(configSig.get(c));
  }
  return { cohorts_total:cohorts.length, unique_bidder_sets_ids_only:setKeys.size, unique_bidder_configs_fingerprints:cfgKeys.size };
}

function diffDays(curr, prev){
  const ch={appeared:[],disappeared:[],list_changed:[],config_changed:[]};
  const all=new Set([...curr.idsList.keys(),...prev.idsList.keys()]);
  for (const c of all){
    const inPrev=prev.idsList.has(c), inCurr=curr.idsList.has(c);
    if (!inPrev &&  inCurr){ ch.appeared.push(c); continue; }
    if ( inPrev && !inCurr){ ch.disappeared.push(c); continue; }
    const pIds=prev.idsList.get(c)||[], cIds=curr.idsList.get(c)||[];
    if (JSON.stringify(pIds)!==JSON.stringify(cIds)) ch.list_changed.push(c);
    if (prev.configSig.get(c)!==curr.configSig.get(c)) ch.config_changed.push(c);
  }
  return ch;
}

(async function main(){
  // Defaults: input ../2.0-bidder-selection-optmised, output .
  const inputDir  = process.argv[2] || path.resolve(__dirname, '../2.0-bidder-selection-optmised');
  const outputDir = process.argv[3] || process.cwd();
  let   windowDays= Number(process.argv[4] || NaN); // if NaN, we’ll auto-set later

  const files = fs.readdirSync(inputDir)
    .filter(f => FILE_RE.test(f))
    .map(f => ({ f, date: parseDateFromName(f) }))
    .filter(x => !!x.date)
    .sort((a,b) => daysDiff(a.date, b.date)); // ascending

  if (!files.length) { console.error('No snapshot files in', inputDir); process.exit(1); }

  // Auto-window = number of snapshot files (unique dates)
  const uniqueDates = [...new Set(files.map(x => x.date))];
  if (!Number.isFinite(windowDays) || windowDays <= 0) windowDays = uniqueDates.length;
  console.log(`Found ${files.length} files (${uniqueDates.length} unique dates). Using windowDays=${windowDays}.`);
  console.log(`Input: ${inputDir}\nOutput: ${outputDir}`);

  const dailyChanges=[];
  let prev=null, prevDate=null;

  for (const {f,date} of files){
    const full=path.join(inputDir,f);
    console.log('Processing', path.basename(full), '→', date);
    const maps=extractFromConfig(readJson(full));
    const summary=summarizeDaily(maps);

    writeJson(path.join(outputDir, `metrics-${date}.json`), {
      date,
      cohorts_total: summary.cohorts_total,
      unique_bidder_sets_ids_only: summary.unique_bidder_sets_ids_only,
      unique_bidder_configs_fingerprints: summary.unique_bidder_configs_fingerprints,
      notes: 'cohort=country|domain|device; set=IDs only; config=IDs+params; placement/RTT ignored'
    });

    writeJson(path.join(outputDir, `fingerprints-${date}.json`), {
      date,
      cohort_fingerprints: Object.fromEntries(maps.configSig.entries()),
      cohort_bidder_lists: Object.fromEntries(maps.idsList.entries())
    });

    if (prev && prevDate){
      const ch=diffDays(maps, prev);
      writeJson(path.join(outputDir, `changes-${date}.json`), {
        date, vs_date: prevDate,
        summary: {
          cohorts_appeared: ch.appeared.length,
          cohorts_disappeared: ch.disappeared.length,
          cohorts_list_changed: ch.list_changed.length,
          cohorts_config_changed: ch.config_changed.length
        },
        examples: {
          appeared: ch.appeared.slice(0,20),
          disappeared: ch.disappeared.slice(0,20),
          config_changed: ch.config_changed.slice(0,10).map(c=>({cohort:c, from:prev.configSig.get(c), to:maps.configSig.get(c)}))
        }
      });
      dailyChanges.push({ date, listChanged:new Set(ch.list_changed), cfgChanged:new Set(ch.config_changed) });
    }
    prev=maps; prevDate=date;
  }

  // Aggregate top changers over last `windowDays` ending at last date
  const lastDate = files[files.length-1].date;
  const start = (()=>{ const d=isoToDate(lastDate); d.setUTCDate(d.getUTCDate() - (windowDays-1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; })();

  const cfgCount=new Map(), listCount=new Map();
  for (const d of dailyChanges){
    if (d.date < start) continue;
    for (const c of d.cfgChanged)  cfgCount.set(c,(cfgCount.get(c)||0)+1);
    for (const c of d.listChanged) listCount.set(c,(listCount.get(c)||0)+1);
  }
  const topN=(m,n=25)=>[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n).map(([cohort,days_changed])=>({cohort,days_changed}));

  writeJson(path.join(outputDir, `cohort-change-totals.json`), {
    window: `auto_${windowDays}_days`,
    last_date: lastDate,
    since_date: start,
    top_cohorts_by_config_changes: topN(cfgCount),
    top_cohorts_by_list_changes:   topN(listCount)
  });

  console.log('✅ Done.');
})().catch(e=>{ console.error(e); process.exit(1); });