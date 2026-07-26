import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { Machine } = await import('./machine.ts');
const { runOne } = await import('./insn-run.ts');
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const baseline = new Uint8Array(readFileSync(join(here, 'insn-baseline.bin')));
const want = process.argv[2];
const labels = new Map();
for (const l of readFileSync(join(here, 'encodings.txt'), 'utf8').split('\n')) {
  const m = /^([0-9A-F]+)\s\s(.+)$/.exec(l.trim());
  if (m) labels.set(m[1], m[2]);
}
const cases = new Map();
for (const l of readFileSync(join(here, 'insn.log'), 'utf8').split('\n')) {
  const m = /^I ([0-9A-F]+) (\d) ([^|]+)\| ([^|]+)/.exec(l.trim());
  if (m) cases.set(`${m[1]}:${m[2]}`, {
    din: m[3].trim().split(/\s+/).slice(0,8).map(x=>parseInt(x,16)),
    ain: m[3].trim().split(/\s+/).slice(8,14).map(x=>parseInt(x,16)),
    out: m[4].trim().split(/\s+/).map(x=>parseInt(x,16)) });
}
const SCRATCH=0x3e4000, LEN=0x400, STACK=0x3e5000, RAM=0x3e0000, CODE=0x3e6000;
class R{s=0x2468ace0;next(){let x=this.s;x=(x^(x<<13))>>>0;x=(x^(x>>>17))>>>0;x=(x^(x<<5))>>>0;this.s=x;return x;}}
const rand=new R();
for (const hex of labels.keys()) {
  for (let trial=0; trial<2; trial++) {
    const m=new Machine(rom);
    for(let i=0;i<baseline.length;i++) m.setByte(RAM+i, baseline[i]);
    for(let i=0;i<LEN;i++) m.setByte(SCRATCH+i, rand.next()%256);
    const d=[],a=[];
    for(let k=0;k<8;k++) d.push(rand.next()>>>0);
    for(let k=0;k<6;k++) a.push(SCRATCH+(rand.next()%(LEN-0x100)));
    const c=cases.get(`${hex}:${trial}`);
    if(!c) continue;
    if(hex!==want) continue;
    for(let k=0;k<8;k++) m[`d${k}`]=d[k];
    for(let k=0;k<6;k++) m[`a${k}`]=a[k];
    m.a6=SCRATCH+0x300; m.a7=SCRATCH+0x380;
    for(let i=0;i<hex.length/2;i++) m.setByte(CODE+i, parseInt(hex.slice(i*2,i*2+2),16));
    console.log(`${hex}  ${labels.get(hex)}  trial ${trial}`);
    console.log('  in d (port):', d.map(x=>x.toString(16)).join(' '));
    console.log('  in d (rom) :', c.din.map(x=>x.toString(16)).join(' '));
    console.log('  in a (port):', a.map(x=>x.toString(16)).join(' '));
    console.log('  in a (rom) :', c.ain.map(x=>x.toString(16)).join(' '));
    try { runOne(m, CODE); } catch(e){ console.log('  threw:', e.message); }
    const names=['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5'];
    names.forEach((n,i)=>{ const g=m[n]>>>0, w=c.out[i]>>>0;
      if(g!==w) console.log(`   ${n}  rom ${w.toString(16)}  port ${g.toString(16)}`); });
  }
}
