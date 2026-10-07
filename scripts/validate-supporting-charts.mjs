import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const data=JSON.parse(readFileSync(join(root,'dashboard','public','data','tic.json'),'utf8'));
const entities=new Map(data.countries.map(c=>[c.country_code,c]));
const rows=new Map(data.records.map(r=>[`${r[0]}|${r[1]}`,r]));
const get=(code,month)=>rows.get(`${code}|${month}`);
const shift=(month,n)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7)};
const latest=data.meta.latest_month,previous=shift(latest,-1),countryCodes=data.countries.filter(c=>c.record_type==='country').map(c=>c.country_code);
const changes=countryCodes.map(code=>{const now=get(code,latest)?.[2],before=get(code,previous)?.[2];return now==null||before==null?null:{code,value:now-before}}).filter(Boolean).sort((a,b)=>b.value-a.value);
const increase=changes.find(x=>x.value>0),decrease=[...changes].reverse().find(x=>x.value<0);
if(!increase||!decrease)throw Error('최신월 증가·감소 국가를 계산할 수 없습니다.');

const total=get('99996',latest)?.[2];
if(total==null)throw Error('최신월 Grand Total이 없습니다.');
const top=countryCodes.map(code=>get(code,latest)).filter(r=>r?.[2]!=null).sort((a,b)=>b[2]-a[2]).slice(0,10);
const topSum=top.reduce((sum,r)=>sum+r[2],0),other=total-topSum,shareSum=(topSum+other)/total*100;
if(Math.abs(shareSum-100)>1e-12)throw Error(`점유율 합계 불일치: ${shareSum}`);

let compositionChecks=0,compositionFailures=0,waterfallChecks=0,waterfallFailures=0;
for(const code of [...countryCodes,'99996']){
 const row=get(code,latest);if(!row)continue;
 const [hold,longTerm,shortTerm]=[row[2],row[3],row[4]];
 if(hold!=null&&longTerm!=null&&shortTerm!=null){compositionChecks++;if(Math.abs(longTerm+shortTerm-hold)>1)compositionFailures++;}
 const prev=get(code,previous)?.[2],net=row[5],valuation=row[8];
 if(latest>='2023-02'&&hold!=null&&prev!=null&&net!=null&&valuation!=null){const residual=hold-prev-net-valuation;waterfallChecks++;if(Math.abs(prev+net+valuation+residual-hold)>.001)waterfallFailures++;}
}
if(compositionFailures)throw Error(`장기+단기 합계 실패 ${compositionFailures}/${compositionChecks}`);
if(waterfallFailures)throw Error(`워터폴 시작·종료 실패 ${waterfallFailures}/${waterfallChecks}`);

console.log(JSON.stringify({status:'PASS',month:latest,comparison_month:previous,max_increase:{country:entities.get(increase.code)?.country_name,code:increase.code,value_usd_mn:increase.value},max_decrease:{country:entities.get(decrease.code)?.country_name,code:decrease.code,value_usd_mn:decrease.value},share:{denominator:'Grand Total',top10_usd_mn:topSum,other_usd_mn:other,unrounded_sum_pct:shareSum,regional_totals_included:false},composition:{checks:compositionChecks,failures:compositionFailures},waterfall:{formula:'current - previous - net transaction - long-term valuation change',checks:waterfallChecks,failures:waterfallFailures}},null,2));
