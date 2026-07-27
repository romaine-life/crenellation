import { readFileSync } from 'node:fs';
const { System } = await import('./system.ts');
const rom = new Uint8Array(readFileSync('src/rom/rom.bin'));
const board = new Uint8Array(readFileSync('src/rom/io-baseline.bin'));
const sys = new System(rom, board);
const m = sys.m;
let outcome = 'ok';
try { sys.run((s) => { if (s.frames >= 12000) throw new Error('enough'); }); }
catch (e) { outcome = e.message.slice(0, 60); }
let pf = 0;
for (let i = 0; i < 0x20000; i += 1) if (m.byte(0x200000 + i)) pf += 1;
console.log(`OUTCOME ${outcome} FRAMES ${sys.frames} PF ${pf} STEPS ${m.steps}`);
