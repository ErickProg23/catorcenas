/* ---------- Motor de Separar ----------
   Funciones puras: sin DOM ni Firebase. Reciben el estado (S) y la fecha de hoy (hoy)
   como parámetros para poder probarlas con Vitest.
   En el navegador se carga como <script> clásico y queda en window.CatEngine;
   en Node se exporta con module.exports. */
(function(root, factory){
  const E = factory();
  if(typeof module==='object' && module.exports) module.exports = E;
  else root.CatEngine = E;
})(typeof self!=='undefined' ? self : this, function(){

/* ---------- Fechas ---------- */
function parseDate(s){ const p=String(s).split('-').map(Number); return new Date(p[0],p[1]-1,p[2]); }
function iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function days(a,b){ return Math.round((b-a)/86400000); }
function periodOf(S,d){ return Math.floor(days(parseDate(S.anchor), d)/14); }
function periodStart(S,k){ return addDays(parseDate(S.anchor), 14*k); }

/* ---------- Deudas ---------- */
/* Movimientos que mueven el saldo después del último "Corregir saldo":
   abonos (restan) y gastos con tarjeta de crédito marcados para sumarse (suman). */
function debtMoves(S){
  const out=[];
  Object.values(S.pays).forEach(p=>{ const d=S.debts[p.debtId]; if(d && (p.ts||0)>(d.baseTs||0)) out.push({ id:p.debtId, date:p.date, delta:-(Number(p.amount)||0), pay:true }); });
  Object.values(S.exps).forEach(e=>{ const d=S.debts[e.cardId]; if(d && e.method==='credit' && e.toDebt!==false && (e.ts||0)>(d.baseTs||0)) out.push({ id:e.cardId, date:e.date, delta:Number(e.amount)||0, pay:false }); });
  return out;
}
function balanceOf(S,id){
  const d=S.debts[id]; if(!d) return 0;
  let b=Number(d.base)||0;
  debtMoves(S).forEach(m=>{ if(m.id===id) b+=m.delta; });
  return Math.max(0, Math.round(b*100)/100);
}
function snowAt(d,p){ return (d.snows||[]).reduce((s,x)=> s+(x.from<=p ? Number(x.amount)||0 : 0), 0); }
function snowSrcNames(d,p){ return (d.snows||[]).filter(x=>x.from<=p).map(x=>x.srcName).filter(Boolean).join(' y '); }

/* ---------- Separar ----------
   Cada pago de una deuda se reparte entre las catorcenas que cobras desde el pago anterior
   hasta su fecha límite. Lo que ya separaste (de antes o en catorcenas pasadas) se descuenta,
   y si separas de menos, lo que falta pasa solo a las siguientes catorcenas. */
const HORIZON=13;
const cents=n=>Math.round(n*100)/100;
function lastDay(y,m){ return new Date(y,m+1,0).getDate(); }
function dueList(d, from, until){
  const out=[];
  if(d.freq==='interval'){
    const step=Number(d.every)||28; if(!d.next) return out;
    let dt=parseDate(d.next); while(dt>from) dt=addDays(dt,-step); while(dt<from) dt=addDays(dt,step);
    while(dt<=until){ out.push(new Date(dt)); dt=addDays(dt,step); }
    return out;
  }
  if(d.freq!=='monthly' && d.freq!=='biweekly') return out;
  const days=[Number(d.day1)].concat(d.freq==='biweekly'?[Number(d.day2)]:[]).filter(x=>x>=1&&x<=31);
  let y=from.getFullYear(), m=from.getMonth();
  while(new Date(y,m,1)<=until){
    days.forEach(dd=>{ const dt=new Date(y,m,Math.min(dd,lastDay(y,m))); if(dt>=from && dt<=until) out.push(dt); });
    m++; if(m>11){ m=0; y++; }
  }
  return out.sort((a,b)=>a-b);
}
function sepKey(payday,id,due){ return payday+'_'+id+'_'+due; }
function skipKey(id,key){ return 'skip_'+id+'_'+key; }
function splitEven(total,n){
  if(n<=1) return [cents(total)];
  const base=Math.floor(total/n); const arr=Array(n).fill(base); arr[n-1]=cents(total-base*(n-1)); return arr;
}
/* El plan arranca en la catorcena actual, o en sepStart si es posterior
   (lo de antes ya lo separaste por fuera). */
function sepK0(S,hoy){ const k=periodOf(S,hoy); return S.sepStart ? Math.max(k, periodOf(S,parseDate(S.sepStart))) : k; }
function computeSep(S,hoy){
  const K0=sepK0(S,hoy);
  const P=[]; for(let i=0;i<HORIZON+3;i++) P.push(iso(periodStart(S,K0+i)));
  const start=P[0], until=addDays(parseDate(P[HORIZON]),45);
  const plan={}; P.forEach(p=>plan[p]=[]);
  const recs=Object.values(S.sep);
  const before=(id,due)=> recs.filter(r=>r.debtId===id && r.due===due && r.payday<start).reduce((s,r)=>s+(Number(r.amount)||0),0);
  const recAt=(p,id,due)=> S.sep[sepKey(p,id,due)];
  const skipped=[];
  const nameCount={}; Object.values(S.debts).forEach(d=>{ const k=String(d.name).toLowerCase(); nameCount[k]=(nameCount[k]||0)+1; });
  const label=d=> nameCount[String(d.name).toLowerCase()]>1 ? d.name+' ('+(d.kind==='card'?'tarjeta':'préstamo')+')' : d.name;
  const paidMap=paidOccs(S), pending=[];
  // "Por pagar": pagos que vencen antes de la catorcena del plan (desde que empezaste a usar la app, máx. 35 días atrás) y no registraste.
  const lo=[iso(addDays(hoy,-35)), S.anchor||'0000'].sort().pop();
  const pastPaydays=[]; for(let k=periodOf(S,parseDate(lo)); k<K0; k++){ const x=iso(periodStart(S,k)); if(x>=lo) pastPaydays.push(x); }
  const planOne=(id,d,remaining,name,grp)=>{
    const amt0=Number(d.amount)||0, extra=Number(d.extra)||0;
    const ev=[];
    { const pend=[];
      // Una deuda o pago que agregaste hoy no puede tener pagos vencidos de antes de que lo agregaras.
      const born= d.createdTs ? iso(new Date(d.createdTs)) : '0000', lo1=[lo,born].sort().pop(), pdays=pastPaydays.filter(x=>x>=born);
      if(d.freq==='catorcena') pdays.forEach(x=>pend.push({kind:'due', date:x, key:x}));
      else dueList(d, parseDate(lo1), addDays(parseDate(start),-1)).map(iso).forEach(x=>pend.push({kind:'due', date:x, key:x}));
      if(extra>0 && grp==='debt') pdays.forEach(x=>pend.push({kind:'extra', date:x, key:'x'+x}));
      if(grp==='debt') pdays.forEach(x=>{ if(snowAt(d,x)>0) pend.push({kind:'extra', date:x, key:'s'+x, snow:true}); });
      let left=remaining;
      pend.sort((a,b)=>a.date.localeCompare(b.date)).forEach(e=>{
        const pi=paidMap[id+'|'+e.key]; if(pi && pi.ext) return;
        if(e.kind==='extra' && S.sep[skipKey(id,e.key)]) return;
        const full=e.kind==='extra'?(e.snow?snowAt(d,e.date):extra):amt0, pAmt=pi?pi.amount:0;
        const amt=cents(Math.min(Math.max(0,full-pAmt), left)); if(amt<=0.5) return; left-=amt;
        pending.push({ id, name, grp: e.kind==='extra'?'extra':grp, kind:e.kind, due:e.date, key:e.key, amount:full, toPay:amt, paidAmt:pAmt, share:amt, part:1, of:1, already:0, snow:!!e.snow, snowSrc:e.snow?snowSrcNames(d,e.date):'' });
      });
    }
    if(d.freq==='catorcena'){ P.forEach(p=>ev.push({kind:'due', date:p, key:p, amount:amt0, W:[p]})); }
    else {
      const dues=dueList(d, addDays(parseDate(start),-70), until).map(iso);
      dues.forEach((due,i)=>{
        if(due<start) return;
        const prev=dues[i-1]||iso(addDays(parseDate(due),-31));
        let W=P.filter(p=>p>prev && p<=due && p>=start), urgent=false;
        if(!W.length){ W=[P.filter(p=>p<=due).pop()||start]; urgent=true; }
        ev.push({kind:'due', date:due, key:due, amount:amt0, W, urgent});
      });
    }
    if(extra>0 && grp==='debt') P.forEach(p=>ev.push({kind:'extra', date:p, key:'x'+p, amount:extra, W:[p]}));
    if(grp==='debt') P.forEach(p=>{ const a=snowAt(d,p); if(a>0) ev.push({kind:'extra', date:p, key:'s'+p, amount:a, W:[p], snow:true}); });
    // En orden de fecha; el mismo día, primero el pago obligatorio.
    ev.sort((a,b)=>a.date.localeCompare(b.date)||(a.kind==='due'?-1:1));
    ev.forEach(e=>{
      if(e.kind==='extra' && S.sep[skipKey(id,e.key)]){
        const p=e.W[0]; if(plan[p]) plan[p].push({ id, name, grp:'extra', kind:'extra', due:e.date, key:e.key, amount:cents(e.amount), toPay:0, paidAmt:0, share:0, part:1, of:1, already:0, liq:false, urgent:false, rec:null, paid:null, snow:!!e.snow, snowSrc:e.snow?snowSrcNames(d,e.date):'', skipped:true, payday:p });
        return;
      }
      // Lo ya pagado de esta fecha (abonos o gastos ligados) se descuenta de lo que falta pagar;
      // como el saldo ya refleja esos abonos, solo lo que falta pagar consume el saldo restante.
      const pinfo=paidMap[id+'|'+e.key];
      const paidAmt= pinfo ? (pinfo.ext ? Infinity : pinfo.amount) : 0;
      let toPay=Math.max(0, cents(e.amount-paidAmt));
      if(toPay>0.005) toPay=cents(Math.min(toPay, remaining));
      if(!pinfo && toPay<=0.005) return;
      const paid= pinfo && toPay<=0.5 ? pinfo : null;
      if(paid) toPay=0;
      remaining=cents(remaining-toPay);
      const amt=cents(e.amount);
      const liq=!paid && grp==='debt' && remaining<=0.5;
      // Si ya está pagado completo, lo que tocaba separar en esta catorcena se sigue mostrando (y contando).
      // Lo que ya abonaste salió de lo que separaste en el plan (hasta donde alcance lo separado);
      // por eso eso sigue contando como "separado" y no se le vuelve a restar a las siguientes catorcenas.
      // Cuenta todo lo separado para esta fecha, también en catorcenas pasadas (si abonaste con eso, ya no está guardado).
      const recSum=recs.filter(r=>!r.move && r.debtId===id && r.due===e.key && r.payday!=='paid').reduce((s,r)=>s+(Number(r.amount)||0),0);
      const paidFromPlan= pinfo && !pinfo.ext ? Math.min(Number(pinfo.amount)||0, recSum) : 0;
      const already=before(id,e.key), need=Math.max(0,cents((paid?amt:toPay+paidFromPlan)-already));
      const shares=splitEven(need, e.W.length);
      const r0=e.W[0]===start ? recAt(start,id,e.key) : null;
      if(r0 && e.W.length>1){
        const diff=shares[0]-(Number(r0.amount)||0), per=diff/(e.W.length-1);
        for(let i=1;i<shares.length;i++) shares[i]=Math.max(0,cents(shares[i]+per));
      }
      // Lo que decidiste pasar de una catorcena a la siguiente (siempre antes de la fecha de pago).
      const mOut=e.W.map(()=>0), mIn=e.W.map(()=>0), mFrom=e.W.map(()=>[]);
      if(!paid) recs.filter(r=>r.move && r.id===id && r.key===e.key && r.from>=start).sort((a,b)=>a.from.localeCompare(b.from)).forEach(r=>{
        const i=e.W.indexOf(r.from), j=e.W.indexOf(r.to); if(i<0 || j<=i) return;
        const x=cents(Math.min(Number(r.amount)||0, shares[i])); if(x<=0) return;
        shares[i]=cents(shares[i]-x); shares[j]=cents(shares[j]+x); mOut[i]=cents(mOut[i]+x); mIn[j]=cents(mIn[j]+x); mFrom[j].push(r.from);
      });
      e.W.forEach((p,i)=>{
        if(!plan[p]) return;
        if(paid && p>start) return; // ya pagado: nada más que separar después
        const rec=recAt(p,id,e.key);
        if(shares[i]<=0.005 && !rec && !paid && !mOut[i] && !(p===start && (already>0 || (pinfo && !pinfo.ext)))) return;
        const canMove= e.kind==='due' && !paid && !rec && i<e.W.length-1 && shares[i]>0.5;
        plan[p].push({ id, name, grp: e.kind==='extra'?'extra':grp, kind:e.kind, due:e.date, key:e.key, amount:amt, toPay, paidAmt: pinfo&&!pinfo.ext?pinfo.amount:0, share:shares[i], part:i+1, of:e.W.length, already:cents(Math.max(0,already-paidFromPlan)), liq, urgent:!!e.urgent, rec, paid, snow:!!e.snow, snowSrc:e.snow?snowSrcNames(d,e.date):'',
          movedOut:mOut[i], movedTo:mOut[i]?e.W[i+1]:null, movedIn:mIn[i], movedFrom:mFrom[i], moveTo:canMove?e.W[i+1]:null, payday:p });
      });
    });
  };
  Object.entries(S.debts).sort((a,b)=>(a[1].createdTs||0)-(b[1].createdTs||0)).forEach(([id,d])=>{
    const bal=balanceOf(S,id);
    if(!d.freq){ if(bal>0.5) skipped.push(d.name); return; }
    planOne(id,d,bal,label(d),'debt');
  });
  // Pagos fijos (gym, teléfono…): sin saldo que se acabe.
  Object.entries(S.fixed).sort((a,b)=>(a[1].createdTs||0)-(b[1].createdTs||0)).forEach(([fid,f])=>{
    if(!(Number(f.amount)>0)) return;
    planOne('f-'+fid, f, Infinity, f.name, 'fixed');
  });
  // Ahorro: lo que toca guardar de cada pago hasta llegar a la meta.
  goalList(S).forEach(([gid,g])=>{
    const pr=goalProjection(S,hoy,gid), id='g-'+gid;
    Object.entries(pr.byP).forEach(([p,v])=>{
      if(!plan[p]) return;
      const key='v'+p, rec=recAt(p,id,key), paid=v.paid ? paidMap[id+'|'+key] : null;
      plan[p].push({ id, name:g.name, grp:'save', kind:'save', due:p, key, amount:v.amount, toPay:v.paid?0:v.amount, paidAmt:0, share:v.amount, part:1, of:1, already:0, liq:false, urgent:false, rec, paid, goalId:gid });
    });
  });
  Object.values(plan).forEach(list=>list.sort((a,b)=>a.due.localeCompare(b.due)||a.name.localeCompare(b.name)));
  pending.sort((a,b)=>a.due.localeCompare(b.due)||a.name.localeCompare(b.name));
  return { P, plan, skipped, pending };
}
/* Pagos ya hechos, ligados a su fecha de pago: abonos (debtPayments) y gastos de pagos fijos (expenses) con "occ". */
function paidOccs(S){
  const m={};
  const add=(occ,amt,date,col,doc)=>{ const x=m[occ]||(m[occ]={ amount:0, date:'', col, doc, docs:[] }); x.amount=cents(x.amount+amt); if(date>=x.date){ x.date=date; x.col=col; x.doc=doc; } x.docs.push([col,doc]); };
  Object.entries(S.pays).forEach(([pid,p])=>{ if(p.occ) add(p.occ, Number(p.amount)||0, p.date||'', 'debtPayments', pid); });
  Object.entries(S.exps).forEach(([eid,e])=>{ if(e.occ) add(e.occ, Number(e.amount)||0, e.date||'', 'expenses', eid); });
  Object.entries(S.gmoves||{}).forEach(([mid,g])=>{ if(g.occ) add(g.occ, Number(g.amount)||0, g.date||'', 'goalMoves', mid); });
  Object.entries(S.sep).forEach(([sid,r])=>{ if(r.paidExt && r.occ) m[r.occ]={ amount:0, date:r.date||'', col:'sepDone', doc:sid, ext:true }; });
  return m;
}

/* ---------- Ahorro ---------- */
function goalList(S){ return Object.entries(S.goals).sort((a,b)=>(a[1].createdTs||0)-(b[1].createdTs||0)); }
function goalBal(S,gid){
  const g=S.goals[gid]; if(!g) return 0; let b=Number(g.base)||0;
  Object.values(S.gmoves).forEach(m=>{ if(m.goalId===gid && (m.ts||0)>(Number(g.baseTs)||0)) b+=Number(m.amount)||0; });
  return cents(b);
}
function goalPerCatAt(g,p){
  let a=0; if(Number(g.perCat)>0 && g.from && g.from<=p) a+=Number(g.perCat);
  (g.feeds||[]).forEach(f=>{ if(f.from<=p) a+=Number(f.amount)||0; });
  return a;
}
function goalProjection(S, hoy, gid, extraFeed){
  const g0=S.goals[gid]; if(!g0) return { byP:{}, reach:null };
  const g= extraFeed ? Object.assign({}, g0, { feeds:(g0.feeds||[]).concat([extraFeed]) }) : g0;
  const target=Number(g.target)||0; let bal=goalBal(S,gid);
  const K0=sepK0(S,hoy), P=[]; for(let i=0;i<26;i++) P.push(iso(periodStart(S,K0+i)));
  const pm=paidOccs(S), t=iso(hoy), ev=P.map(p=>({ t:'p', date:p }));
  (g.aportes||[]).forEach(a=>{ if(!a.done && a.date>=t) ev.push({ t:'a', date:a.date, amount:Number(a.amount)||0 }); });
  ev.sort((a,b)=>a.date.localeCompare(b.date)||(a.t==='a'?-1:1));
  const byP={}; let reach= target>0 && bal>=target-0.5 ? t : null;
  ev.forEach(e=>{
    if(e.t==='p'){
      const pd=pm['g-'+gid+'|v'+e.date];
      if(pd){ byP[e.date]={ amount:pd.amount, paid:true }; }
      else if(!reach){ const a=cents(Math.min(goalPerCatAt(g,e.date), target-bal)); if(a>0.5){ byP[e.date]={ amount:a }; bal=cents(bal+a); } }
    } else if(!reach){ bal=cents(bal+e.amount); }
    if(!reach && target>0 && bal>=target-0.5) reach=e.date;
  });
  return { byP, reach };
}

return { parseDate, iso, addDays, days, periodOf, periodStart,
  debtMoves, balanceOf, snowAt, snowSrcNames,
  HORIZON, cents, lastDay, dueList, sepKey, skipKey, splitEven, sepK0, computeSep, paidOccs,
  goalList, goalBal, goalPerCatAt, goalProjection };
});
