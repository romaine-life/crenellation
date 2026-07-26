// The 68000 machine the ported routines run on.
//
// Ports are emitted from the ROM's own instructions, so they need the same
// state the chip has: eight data and eight address registers, condition flags,
// and byte-addressable memory. Sizes matter everywhere - a byte write into a
// register leaves the upper 24 bits alone, and that detail is load-bearing in
// several routines.

export class Machine {
  d0 = 0; d1 = 0; d2 = 0; d3 = 0; d4 = 0; d5 = 0; d6 = 0; d7 = 0;
  a0 = 0; a1 = 0; a2 = 0; a3 = 0; a4 = 0; a5 = 0; a6 = 0; a7 = 0;

  /** Condition flags. */
  c = false; v = false; z = false; n = false; x = false;

  /** Status register. The ports have no interrupts, so writes are recorded
   *  rather than acted on - a routine that masks interrupts still behaves
   *  correctly, it just has nothing to mask. */
  sr = 0;

  /** Set by a STOP instruction, which only appears on the crash paths. */
  stopped = false;

  /**
   * Some routines call through a function pointer supplied by the caller, or
   * into display and sound code that expects hardware state. Running one of
   * those in isolation reaches an address that is not code at all.
   *
   * With `stubMissing` set, such a call is recorded and skipped instead of
   * throwing, so the arithmetic under test can be checked on its own. The list
   * is deliberately visible: a test that stubs a call should say so, not
   * quietly pass.
   */
  stubMissing = false;
  readonly missingCalls: number[] = [];

  /** TRAP goes to an exception vector; nothing in the game's normal flow
   *  reaches one, so this records it instead of pretending to dispatch. */
  trapped: number | null = null;

  trap(n: number): void {
    this.trapped = n;
  }

  /** MOVEP transfers alternating bytes to a peripheral. Only the sound driver
   *  uses it, and the sound chips are not modelled, so it is a no-op that
   *  records having happened. */
  movepCount = 0;
  movep(_v: number): void {
    this.movepCount += 1;
  }

  /** Sparse memory: the ROM is dense, RAM is not. */
  readonly rom: Uint8Array;
  readonly ram = new Map<number, number>();

  constructor(rom: Uint8Array) {
    this.rom = rom;
  }

  // ---- memory -----------------------------------------------------------

  byte(addr: number): number {
    addr >>>= 0;
    if (addr < this.rom.length) return this.rom[addr];
    return this.ram.get(addr) ?? 0;
  }

  setByte(addr: number, v: number): void {
    this.ram.set(addr >>> 0, v & 0xff);
  }

  load(addr: number, bits: number): number {
    addr >>>= 0;
    if (bits === 8) return this.byte(addr);
    if (bits === 16) return (this.byte(addr) << 8) | this.byte(addr + 1);
    return (
      ((this.byte(addr) << 24) |
        (this.byte(addr + 1) << 16) |
        (this.byte(addr + 2) << 8) |
        this.byte(addr + 3)) >>> 0
    );
  }

  store(addr: number, v: number, bits: number): void {
    addr >>>= 0;
    if (bits === 8) { this.setByte(addr, v); return; }
    if (bits === 16) { this.setByte(addr, v >>> 8); this.setByte(addr + 1, v); return; }
    this.setByte(addr, v >>> 24);
    this.setByte(addr + 1, v >>> 16);
    this.setByte(addr + 2, v >>> 8);
    this.setByte(addr + 3, v);
  }

  // ---- register access, size aware --------------------------------------

  /** Read the low `bits` of a register value. */
  rd(regValue: number, bits: number): number {
    if (bits === 8) return regValue & 0xff;
    if (bits === 16) return regValue & 0xffff;
    return regValue >>> 0;
  }

  /** Write `v` into a register, preserving the bits above `bits`. */
  wr(regValue: number, v: number, bits: number): number {
    if (bits === 8) return ((regValue & ~0xff) | (v & 0xff)) >>> 0;
    if (bits === 16) return ((regValue & ~0xffff) | (v & 0xffff)) >>> 0;
    return v >>> 0;
  }

  // ---- postincrement / predecrement -------------------------------------

  private reg(name: string): number {
    return (this as unknown as Record<string, number>)[name];
  }
  private setReg(name: string, v: number): void {
    (this as unknown as Record<string, number>)[name] = v >>> 0;
  }

  loadPost(name: string, step: number, bits: number): number {
    const a = this.reg(name);
    const v = this.load(a, bits);
    this.setReg(name, a + step);
    return v;
  }
  storePost(name: string, step: number, v: number, bits: number): void {
    const a = this.reg(name);
    this.store(a, v, bits);
    this.setReg(name, a + step);
  }
  loadPre(name: string, step: number, bits: number): number {
    const a = this.reg(name) - step;
    this.setReg(name, a);
    return this.load(a, bits);
  }
  storePre(name: string, step: number, v: number, bits: number): void {
    const a = this.reg(name) - step;
    this.setReg(name, a);
    this.store(a, v, bits);
  }

  // ---- helpers ----------------------------------------------------------

  /** Sign extend the low `bits` of v to a JS number. */
  sx(v: number, bits: number): number {
    if (bits === 8) return (v << 24) >> 24;
    if (bits === 16) return (v << 16) >> 16;
    return v | 0;
  }

  /** Set N and Z from a result of the given width; clear V and C. */
  logicFlags(v: number, bits: number): void {
    const s = this.sx(v, bits);
    this.n = s < 0;
    this.z = (bits === 32 ? v >>> 0 : v & ((1 << bits) - 1)) === 0;
    this.v = false;
    this.c = false;
  }

  /** Flags for a subtraction a - b, as cmp and sub produce them. */
  subFlags(a: number, b: number, bits: number): number {
    const sa = this.sx(a, bits);
    const sb = this.sx(b, bits);
    const r = sa - sb;
    this.n = this.sx(r, bits) < 0;
    this.z = this.sx(r, bits) === 0;
    this.v = (sa < 0) !== (sb < 0) && (this.sx(r, bits) < 0) !== (sa < 0);
    this.c = (a >>> 0) < (b >>> 0);
    return r;
  }

  addFlags(a: number, b: number, bits: number): number {
    const sa = this.sx(a, bits);
    const sb = this.sx(b, bits);
    const r = sa + sb;
    this.n = this.sx(r, bits) < 0;
    this.z = this.sx(r, bits) === 0;
    this.v = (sa < 0) === (sb < 0) && (this.sx(r, bits) < 0) !== (sa < 0);
    const mask = bits === 32 ? 0x100000000 : 1 << bits;
    this.c = (a >>> 0) + (b >>> 0) >= mask;
    return r;
  }

  // ---- condition codes --------------------------------------------------

  cond(name: string): boolean {
    switch (name) {
      case 't': return true;
      case 'f': return false;
      case 'eq': return this.z;
      case 'ne': return !this.z;
      case 'cs': return this.c;
      case 'cc': return !this.c;
      case 'mi': return this.n;
      case 'pl': return !this.n;
      case 'vs': return this.v;
      case 'vc': return !this.v;
      case 'lt': return this.n !== this.v;
      case 'ge': return this.n === this.v;
      case 'le': return this.z || this.n !== this.v;
      case 'gt': return !this.z && this.n === this.v;
      case 'ls': return this.c || this.z;
      case 'hi': return !this.c && !this.z;
      default: throw new Error('unknown condition ' + name);
    }
  }
}
