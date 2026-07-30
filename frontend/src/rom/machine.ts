// The 68000 machine the ported routines run on.
//
// Ports are emitted from the ROM's own instructions, so they need the same
// state the chip has: eight data and eight address registers, condition flags,
// and byte-addressable memory. Sizes matter everywhere - a byte write into a
// register leaves the upper 24 bits alone, and that detail is load-bearing in
// several routines.

/**
 * Raised when a routine lowers the interrupt mask far enough to let a pending
 * interrupt in. The board asserts level 4 every frame, and the harness freezes
 * the machine mid-frame, so one is always waiting: `0x620` sets the mask to
 * zero and `0x656` restores a saved 0x2309, and the chip vectors straight to
 * 0x133B2. Without this the port simply returned and the two could not be
 * compared at all.
 */
export class PendingInterrupt extends Error {
  /**
   * `afterInstruction` says where to resume. An interrupt noticed between
   * instructions returns to the one that had not started. But an instruction
   * that lowers the mask - `move.w #$2000, sr` - lets the interrupt in as part
   * of its own execution, and it has already happened, so the chip returns to
   * the instruction after it. Resuming at the wrong one re-runs the unmask
   * every time an interrupt arrives.
   */
  constructor(readonly level: number, readonly afterInstruction = false) {
    super('interrupt');
  }
}

/** Raised by an odd word access; the dispatcher turns it into the exception. */
export class AddressError extends Error {
  constructor() {
    super('address error');
  }
}

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
   * Instruction budget. On hardware a runaway routine is bounded by the frame
   * it runs in; here nothing stops it, and several routines loop forever when
   * fed arbitrary input. Exceeding the budget throws rather than hanging.
   */
  steps = 0;
  budget = 2_000_000;

  /**
   * Cycles the chip would have spent. The board interrupts on wall clock, so
   * counting instructions puts the interrupt in the wrong place - a `divu` and
   * a `moveq` are one instruction each and thirty-five times apart in cost.
   */
  cycles = 0;

  /**
   * Called once per instruction, with the address of the instruction about to
   * run. A test that needs to stop at a particular point can then recognise it
   * by address, which is exact, instead of counting instructions on both sides
   * and hoping the counts mean the same thing.
   */
  pc = 0;
  /** Address of the instruction after the one running, for exception frames. */
  next = 0;
  atPc: ((pc: number) => void) | null = null;
  /** A second hook, so the system can own atPc and a caller can still watch. */
  atPcExtra: ((pc: number) => void) | null = null;

  /**
   * How many exception handlers are running.
   *
   * The two dispatchers take an interrupt at different instants by design -
   * the recompiler between instructions, the decompiled code at the head of a
   * block - so a comparison made while one of them is inside a handler is a
   * comparison of two different moments. The frame in flight differs in the
   * stacked program counter and the Z bit of the stacked condition codes, and
   * the handler's own work is half done in one run and not begun in the other.
   * Both dispatchers maintain this around the call, so a harness can wait for
   * a moment when neither is in one.
   */
  irqDepth = 0;

  /** How many interrupts have been taken. A frame clock both dispatchers
   *  agree on, unlike a cycle count: they charge cycles differently, so the
   *  same wall-clock moment finds them at different instructions. */
  irqTaken = 0;

  /** True while an exception frame is being pushed - see interruptFrame. */
  inFrame = false;

  /**
   * Called when the outermost exception handler returns.
   *
   * The one moment in a frame that means the same thing in both dispatchers:
   * the handler has finished, `rte` has put the stack back, and neither run is
   * part way through anything the other has not started. Comparing two runs
   * anywhere else compares two different moments, because a cycle count is not
   * a program point.
   */
  onIrqReturn: (() => void) | null = null;
  /** Called after every dispatched routine with the stack pointer before and
   *  after, so an imbalance is attributed to the routine that caused it. */
  onCall: ((addr: number, before: number, after: number) => void) | null = null;

  tick(pc = 0): void {
    this.pc = pc;
    if (this.atPc) this.atPc(pc);
    this.steps += 1;
    // An interrupt is taken between instructions, never inside one. Raised
    // here, the instruction about to run has not started, so the address to
    // return to is this one - which `next` already holds, because the
    // instruction before it set `next` to its own successor.
    // The line stays asserted until the device is acknowledged - taking the
    // interrupt does not clear it. The mask the exception raises is what stops
    // it firing again immediately, and if the handler returns without
    // acknowledging, it fires again, which is what the chip does.
    if (this.irqPending && ((this.sr >> 8) & 7) < this.irqPending) {
      const lvl = this.irqPending;
      if (this.clearOnTake) this.irqPending = 0;
      throw new PendingInterrupt(lvl);
    }
    if (this.steps > this.budget) {
      throw new Error('instruction budget exhausted after ' + this.steps + ' steps');
    }
  }

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

  /**
   * Stack the address-error frame and give back the handler address. The frame
   * is seven words: the special status word, the address that faulted, the
   * instruction register, the status register and the program counter.
   */
  /** How many address-error exceptions this machine has vectored. The
   *  decompiled routines model the routine, not the chip's fault handling, so
   *  a run that went down this path is not something they can be compared
   *  against. */
  addressErrors = 0;

  addressErrorFrame(): number {
    this.addressErrors += 1;
    // Taken from the chip rather than the manual. Faulting it deliberately -
    // `move.w (a0), d0` with a0 odd - and reading the stack back shows the
    // program counter pushed is the address *after* the instruction, not the
    // instruction's own, and the special status word carries the top byte of
    // the instruction register with it.
    const at = this.pc >>> 0;
    const ir = this.load(at & 0xfffffe, 16);
    this.storePre('a7', 4, this.next >>> 0, 32);
    this.storePre('a7', 2, this.getSR(), 16);
    this.storePre('a7', 2, ir, 16);
    this.storePre('a7', 4, this.faultAddr, 32);
    this.storePre('a7', 2, ((ir & 0xff00) | (this.faultWrite ? 0x05 : 0x15)) & 0xffff, 16);
    return this.load(0x0c, 32);
  }

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

  /**
   * Whether any access left the memory the port models.
   *
   * The port models ROM and work RAM. The board also has a playfield bitmap,
   * a palette, sound chips and input ports, and an instruction pointed at
   * those reads something the port cannot know. Tests set `trackOffMap` so
   * they can tell "this rule is wrong" apart from "this case asked about
   * hardware the port does not implement".
   */
  trackOffMap = false;
  offMap = false;
  /** Whether the caller has loaded the device snapshot. */
  ioModelled = false;

  /** Where the off-map accesses went, so the gap can be named rather than
   *  guessed at. Only the first few are kept; the address is rounded to the
   *  device, not the byte. */
  readonly offMapAt: number[] = [];

  /**
   * Fold the mirrors the board decodes. 0x800000 reads back exactly as the
   * program ROM does, and 0x540000, 0x940000 and 0xD40000 are the same thing
   * as 0x140000 - the top address lines are not all decoded.
   */
  private fold(addr: number): number {
    if (addr >= 0x800000 && addr <= 0x8fffff) return addr - 0x800000;
    if (addr >= 0x540000 && addr <= 0x57ffff) return addr - 0x400000;
    if (addr >= 0x940000 && addr <= 0x97ffff) return addr - 0x800000;
    if (addr >= 0xd40000 && addr <= 0xd7ffff) return addr - 0xc00000;
    if (addr >= 0xd00000 && addr <= 0xd1ffff) return addr - 0x800000;
    return addr;
  }

  private note(addr: number): void {
    if (addr < this.rom.length) return;
    // Probed from the board: work RAM runs to 0x3FFFFF, and the playfield
    // bitmap is ordinary memory rather than a device. Both are modelled, so
    // reaching them is not a gap.
    if (addr >= 0x3e0000 && addr <= 0x3fffff) return;
    if (addr >= 0x200000 && addr <= 0x21ffff) return;
    // The palette, the two sound chips and the input ports. The port does not
    // implement them, but the harness hands it a snapshot of what they held
    // while the machine was frozen, which is enough for a read to compare.
    if (this.ioModelled) {
      if (addr >= 0x3c0000 && addr <= 0x3c0fff) return;
      if (addr >= 0x460000 && addr <= 0x460fff) return;
      if (addr >= 0x480000 && addr <= 0x480fff) return;
      if (addr >= 0x640000 && addr <= 0x640fff) return;
      if (addr >= 0x140000 && addr <= 0x17ffff) return;
      if (addr >= 0x500000 && addr <= 0x51ffff) return;
      // the watchdog, and the scanline register the frame handler writes
      if (addr >= 0x72fffe && addr <= 0x72ffff) return;
      if (addr >= 0x7efffe && addr <= 0x7effff) return;
    }
    this.offMap = true;
    if (this.offMapAt.length < 4) this.offMapAt.push(addr);
  }

  /**
   * Input ports. The board presents these as bytes with a bit low while its
   * button is held, and the game polls them directly rather than through any
   * routine, so the read has to be answered here.
   */
  inputAt: ((addr: number) => number) | null = null;
  /** Whether to answer sound-chip reads rather than replay a snapshot. */
  sound = false;

  /**
   * The trackball counters at 0x6C0000.
   *
   * Six of the eight bytes are read together each time the game samples the
   * controls: it takes the counter, negates it and subtracts what it read
   * last time, so what moves the cursor is the change between frames, not the
   * value. Answering a constant - which is what an unmapped address does -
   * is a trackball nobody is touching.
   */
  trackAt: ((addr: number) => number) | null = null;

  byte(addr: number): number {
    // The 68000 has a 24-bit address bus - A24 to A31 do not exist - so an
    // address above 16 MiB is not "off the map", it wraps. A pointer that
    // computes 0x101FF00 reads 0x01FF00, which is ROM, and the chip gets real
    // data there. Not masking made every one of those look like a read of
    // nothing.
    addr = this.fold((addr >>> 0) & 0xffffff);
    if (this.trackOffMap) this.note(addr);
    if (addr < this.rom.length) return this.rom[addr];
    if (this.inputAt && addr >= 0x640000 && addr <= 0x640003) return this.inputAt(addr);
    // The sound chip status. A frozen snapshot says the voices are busy for
    // ever, and the driver waits for one to free before it advances its queue -
    // which is what the main loop is waiting on in turn. Nothing here plays
    // sound yet, so report every voice idle.
    if (this.sound && addr >= 0x460000 && addr <= 0x460fff) return 0;
    if (this.trackAt && addr >= 0x6c0000 && addr <= 0x6c0007) return this.trackAt(addr);
    return this.ram.get(addr) ?? 0;
  }

  /** Watch a range of addresses; the callback gets the address, the value and
   *  the instruction that wrote it. For finding who fills a buffer - or who
   *  never does. */
  watchLo = -1;
  watchHi = -1;
  onWrite: ((addr: number, v: number, pc: number) => void) | null = null;

  setByte(addr: number, v: number): void {
    addr = this.fold((addr >>> 0) & 0xffffff);
    // The frame handler acknowledges the interrupt by clearing this, which is
    // what drops the line. Until then it stays asserted.
    if (addr >= 0x7efffe && addr <= 0x7effff) this.irqPending = 0;
    if (this.onWrite && addr >= this.watchLo && addr <= this.watchHi) {
      this.onWrite(addr, v & 0xff, this.pc);
    }
    if (this.trackOffMap) this.note(addr);
    this.ram.set(addr, v & 0xff);
  }

  /**
   * A word or long access on an odd address is an address error on the 68000:
   * the chip stacks a seven-word frame and vectors through 0x0C. Not modelling
   * it meant the port carried on computing where the chip had already
   * restarted, and every routine that got there became uncomparable.
   *
   * Thrown rather than handled here, because the transfer of control has to
   * happen outside the instruction; the dispatcher catches it.
   */
  faultAddr = 0;
  faultWrite = false;

  private oddAccess(addr: number, bits: number, write: boolean): void {
    if (bits < 16 || (addr & 1) === 0) return;
    this.faultAddr = addr >>> 0;
    this.faultWrite = write;
    throw new AddressError();
  }

  load(addr: number, bits: number): number {
    this.oddAccess(addr, bits, false);
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
    this.oddAccess(addr, bits, true);
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
    if (bits === 32) {
      // A long written through a pre-decremented address goes low word first.
      // The bytes end up in the same places either way, so nothing that
      // compares final state can see this - only the order of the writes.
      this.store(a + 2, v & 0xffff, 16);
      this.store(a, (v >>> 16) & 0xffff, 16);
      return;
    }
    this.store(a, v, bits);
  }

  // ---- helpers ----------------------------------------------------------

  /** Sign extend the low `bits` of v to a JS number. */
  sx(v: number, bits: number): number {
    if (bits === 8) return (v << 24) >> 24;
    if (bits === 16) return (v << 16) >> 16;
    return v | 0;
  }

  /**
   * Flags for a shift. The 68000 sets C (and X) from the last bit shifted out,
   * which a following bcs/bcc depends on; leaving them clear silently takes
   * the wrong branch.
   */
  shiftFlags(result: number, value: number, count: number, bits: number,
             left: boolean, arith = false): void {
    this.logicFlags(result, bits);
    if (arith && left) this.v = this.aslOverflow(value, count, bits);
    if (count === 0) return; // a zero-count shift leaves C alone and clears V
    const bit = left ? bits - count : count - 1;
    // Past the operand width every bit has already gone. A left shift or a
    // logical right shift is then shifting in zeroes, so C is clear; an
    // arithmetic right shift keeps feeding the sign bit out, so C is the sign.
    let c: boolean;
    if (bit >= 0 && bit < bits) c = ((value >>> bit) & 1) === 1;
    else if (!left && arith) c = ((value >>> (bits - 1)) & 1) === 1;
    else c = false;
    this.c = c;
    this.x = c;
  }

  /**
   * The status register as the chip presents it: the flags live in `c`/`v`/
   * `z`/`n`/`x`, and the high byte (interrupt mask and supervisor bit) is
   * whatever was last written. `move sr,dN` reads real flags, so composing it
   * from a stale field returns a number that was never true.
   */
  getSR(): number {
    return ((this.sr & 0xff00)
      | (this.x ? 16 : 0) | (this.n ? 8 : 0) | (this.z ? 4 : 0)
      | (this.v ? 2 : 0) | (this.c ? 1 : 0)) >>> 0;
  }

  /**
   * Where a routine ran off its own end.
   *
   * That is a jump, not a call: the chip pushes nothing and its stack does not
   * grow. The routine hands the address back here and the dispatcher continues
   * there, so a loop that jumps between routines costs no JavaScript stack.
   */
  jump = 0;

  /** Whether the board has an interrupt waiting. The harness sets this. */
  irqPending = 0;
  /** Whether taking the interrupt drops the line. The board holds it until
   *  acknowledged, but a handler that unmasks before acknowledging is then
   *  re-entered at once, which is worth being able to test against. */
  clearOnTake = true;

  /**
   * Whether a halted chip is allowed to wait for an interrupt.
   *
   * The verification harnesses run a routine in isolation with nothing to
   * deliver one, so waiting there would just spin to the budget. Only the
   * booted machine has a board driving interrupts, so only it sets this.
   */
  wakeOnIrq = false;

  /**
   * Halt until an interrupt above the mask arrives, as `stop` does.
   *
   * Time still passes while halted - the board keeps counting scanlines - so
   * the wait has to keep advancing cycles, or the vertical blank that wakes
   * it never comes. `next` is the address the chip reports while stopped: it
   * has already prefetched the instruction after the stop.
   */
  halt(next: number): void {
    this.stopped = true;
    if (!this.wakeOnIrq) return;
    while (this.stopped) {
      if (this.irqPending && ((this.sr >> 8) & 7) < this.irqPending) {
        this.stopped = false;
        return;
      }
      this.cycles += 4;
      this.steps += 1;
      if (this.atPc) this.atPc(next);
      if (this.steps > this.budget) return;   // still halted; the caller gives up
    }
  }

  /** Stack an interrupt frame and give back the handler address. */
  interruptFrame(level: number): number {
    this.irqTaken += 1;
    const sr = this.getSR();
    // The six bytes of the frame are the seam between the two dispatchers, not
    // the game: the chip takes an interrupt between instructions and the
    // decompiled code at the head of a block, so the stacked program counter
    // and the stacked condition codes differ by where in a block the interrupt
    // landed. That is not a difference in what the game did, and it cannot be
    // removed without giving up the thing that makes the decompilation a
    // decompilation - its expressions span instructions, so there is no
    // instruction boundary to poll at. Marked so a harness can tell the seam
    // from the game.
    this.inFrame = true;
    this.storePre('a7', 4, this.next >>> 0, 32);
    this.storePre('a7', 2, sr, 16);
    this.inFrame = false;
    this.sr = ((sr & 0xf8ff) | 0x2000 | (level << 8)) & 0xffff;
    return this.load(0x60 + level * 4, 32);
  }

  setSR(v: number): void {
    this.sr = v & 0xffff;
    this.x = (v & 16) !== 0;
    this.n = (v & 8) !== 0;
    this.z = (v & 4) !== 0;
    this.v = (v & 2) !== 0;
    this.c = (v & 1) !== 0;
    if (this.irqPending && ((v >> 8) & 7) < this.irqPending) {
      const lvl = this.irqPending;
      if (this.clearOnTake) this.irqPending = 0;
      throw new PendingInterrupt(lvl, true);
    }
  }

  /**
   * Rotate through the extend bit. The X bit joins the operand, so the rotate
   * is over `bits + 1` places, and X ends up holding the bit that came out.
   */
  roxFlags(value: number, count: number, bits: number, left: boolean): number {
    const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
    let v = value & mask;
    let x = this.x;
    const n = count % (bits + 1);
    for (let i = 0; i < n; i += 1) {
      if (left) {
        const out = (v >>> (bits - 1)) & 1;
        v = ((v << 1) & mask) | (x ? 1 : 0);
        x = out === 1;
      } else {
        const out = v & 1;
        v = ((v >>> 1) | ((x ? 1 : 0) << (bits - 1))) & mask;
        x = out === 1;
      }
    }
    this.logicFlags(v >>> 0, bits);
    this.x = x;
    this.c = x;                 // a zero count leaves C equal to X, as on the chip
    return v >>> 0;
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
  /**
   * V for an arithmetic left shift: set if the sign bit changed at any point
   * during the shift, which is not the same as the result simply being
   * negative. Nothing else in the flag set has this shape.
   */
  aslOverflow(value: number, count: number, bits: number): boolean {
    if (count === 0) return false;
    const sv = this.sx(value, bits);
    if (count >= bits) return sv !== 0;
    const top = sv >> (bits - 1 - count);
    return top !== 0 && top !== -1;
  }

  subFlags(a: number, b: number, bits: number, setX = true): number {
    const sa = this.sx(a, bits);
    const sb = this.sx(b, bits);
    const r = sa - sb;
    this.n = this.sx(r, bits) < 0;
    this.z = this.sx(r, bits) === 0;
    this.v = (sa < 0) !== (sb < 0) && (this.sx(r, bits) < 0) !== (sa < 0);
    this.c = (a >>> 0) < (b >>> 0);
    // cmp is the one subtraction that leaves X alone: it is a comparison, not
    // an arithmetic result, and an addx or subx after it must still see the X
    // the earlier arithmetic left behind.
    if (setX) this.x = this.c;
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
    this.x = this.c;
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
