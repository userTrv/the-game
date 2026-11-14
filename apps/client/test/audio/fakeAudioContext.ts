/**
 * Minimal in-memory stand-in for the Web Audio API: just enough of the node graph for the audio engine,
 * with a virtual clock. It is stricter than a real context in two ways that help testing: argument errors
 * are both thrown and recorded in `violations` (the engine swallows exceptions by design), and every
 * automation call is kept so that envelopes can be evaluated analytically.
 */

export type NodeKind =
  | 'destination'
  | 'gain'
  | 'osc'
  | 'buffer'
  | 'biquad'
  | 'compressor'
  | 'convolver'
  | 'panner'
  | 'delay';

export interface ParamEvent {
  kind: 'set' | 'lin' | 'exp' | 'target';
  value: number;
  time: number;
  /** Time constant of a `target` event. */
  tc: number;
  param: FakeParam;
}

export class FakeParam {
  readonly events: ParamEvent[] = [];
  private base: number;

  constructor(
    readonly ctx: FakeAudioContext,
    readonly owner: FakeNode,
    readonly name: string,
    value: number,
  ) {
    this.base = value;
  }

  get value(): number {
    return this.valueAt(this.ctx.currentTime);
  }

  set value(v: number) {
    if (!Number.isFinite(v)) this.ctx.fail(`${this.label}.value = ${v}`);
    if (this.events.length) this.add('set', v, this.ctx.currentTime);
    else this.base = v;
  }

  get label(): string {
    return `${this.owner.kind}.${this.name}`;
  }

  private add(kind: ParamEvent['kind'], value: number, time: number, tc = 0): this {
    const { ctx } = this;
    if (!Number.isFinite(value) || !Number.isFinite(time) || !Number.isFinite(tc)) {
      ctx.fail(`${this.label} ${kind}: non-finite argument (${value}, ${time}, ${tc})`);
    }
    if (time < 0 || tc < 0) ctx.fail(`${this.label} ${kind}: negative time`);
    if (time < ctx.currentTime - 1e-6) ctx.fail(`${this.label} ${kind}: scheduled in the past`);
    if (kind === 'exp' && value === 0) ctx.fail(`${this.label}: exponential ramp to 0`);
    const e: ParamEvent = { kind, value, time, tc, param: this };
    let i = this.events.length;
    while (i > 0 && (this.events[i - 1]?.time ?? 0) > time) i--;
    this.events.splice(i, 0, e);
    ctx.log.push(e);
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    return this.add('set', value, time);
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.add('lin', value, time);
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    return this.add('exp', value, time);
  }

  setTargetAtTime(value: number, time: number, tc: number): this {
    return this.add('target', value, time, tc);
  }

  cancelScheduledValues(time: number): this {
    if (!Number.isFinite(time) || time < 0) this.ctx.fail(`${this.label} cancel: bad time ${time}`);
    // Keep the level reached so far, like a real context does when a running ramp is cancelled and re-anchored.
    const held = this.valueAt(time);
    let n = this.events.length;
    while (n > 0 && (this.events[n - 1]?.time ?? 0) >= time) n--;
    this.events.length = n;
    if (!n) this.base = held;
    return this;
  }

  /** Value of the automation timeline at time `t` (modulation inputs are not included). */
  valueAt(t: number): number {
    let v = this.base;
    let from = 0;
    const ev = this.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (!e) break;
      if (e.kind === 'set') {
        if (t < e.time) return v;
        v = e.value;
        from = e.time;
      } else if (e.kind === 'target') {
        if (t < e.time) return v;
        const next = ev[i + 1];
        const until = next && next.time < t ? next.time : t;
        const reached = e.tc > 0 ? e.value + (v - e.value) * Math.exp(-(until - e.time) / e.tc) : e.value;
        if (!next || t <= next.time) return reached;
        v = reached;
        from = next.time;
      } else {
        if (e.kind === 'exp' && !(v * e.value > 0)) {
          this.ctx.fail(`${this.label}: exponential ramp from ${v} to ${e.value}`, false);
        }
        if (t < e.time) {
          if (t <= from) return v;
          const k = (t - from) / (e.time - from);
          return e.kind === 'lin' ? v + (e.value - v) * k : v * (e.value / v) ** k;
        }
        v = e.value;
        from = e.time;
      }
    }
    return v;
  }

  /** Smallest and largest value the timeline ever asks for. */
  range(): [number, number] {
    const values = this.events.map((e) => e.value);
    // The initial value only matters when nothing replaces it outright.
    if (this.events[0]?.kind !== 'set') values.push(this.base);
    return [Math.min(...values), Math.max(...values)];
  }
}

export class FakeNode {
  readonly outputs: (FakeNode | FakeParam)[] = [];

  constructor(
    readonly ctx: FakeAudioContext,
    readonly kind: NodeKind,
  ) {
    ctx.nodes.push(this);
  }

  protected param(name: string, value: number): FakeParam {
    return new FakeParam(this.ctx, this, name, value);
  }

  connect(dest: FakeNode | FakeParam): FakeNode | undefined {
    if (!(dest instanceof FakeNode) && !(dest instanceof FakeParam)) this.ctx.fail(`${this.kind}.connect: bad target`);
    if (!this.outputs.includes(dest)) this.outputs.push(dest);
    this.ctx.connected.add(this);
    return dest instanceof FakeNode ? dest : undefined;
  }

  disconnect(): void {
    this.outputs.length = 0;
    this.ctx.connected.delete(this);
  }
}

export class FakeGain extends FakeNode {
  readonly gain = this.param('gain', 1);
}

export class FakeSource extends FakeNode {
  startTime: number | null = null;
  stopTime: number | null = null;
  ended = false;
  onended: (() => void) | null = null;

  start(when = 0, offset = 0): void {
    if (this.startTime !== null) this.ctx.fail(`${this.kind}.start called twice`);
    if (!Number.isFinite(when) || when < 0 || !Number.isFinite(offset) || offset < 0) {
      this.ctx.fail(`${this.kind}.start(${when}, ${offset})`);
    }
    this.startTime = Math.max(when, this.ctx.currentTime);
    this.ctx.running.add(this);
  }

  stop(when = 0): void {
    if (this.startTime === null) this.ctx.fail(`${this.kind}.stop before start`);
    if (!Number.isFinite(when) || when < 0) this.ctx.fail(`${this.kind}.stop(${when})`);
    this.stopTime = Math.max(when, this.ctx.currentTime);
  }
}

export class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency = this.param('frequency', 440);
  readonly detune = this.param('detune', 0);
}

export class FakeBuffer {
  readonly duration: number;
  private readonly data: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const d = this.data[channel];
    if (!d) throw new RangeError(`no channel ${channel}`);
    return d;
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = this.param('playbackRate', 1);
}

export class FakeBiquad extends FakeNode {
  type = 'lowpass';
  readonly frequency = this.param('frequency', 350);
  readonly Q = this.param('Q', 1);
  readonly gain = this.param('gain', 0);
  readonly detune = this.param('detune', 0);
}

export class FakeCompressor extends FakeNode {
  readonly threshold = this.param('threshold', -24);
  readonly knee = this.param('knee', 30);
  readonly ratio = this.param('ratio', 12);
  readonly attack = this.param('attack', 0.003);
  readonly release = this.param('release', 0.25);
  readonly reduction = 0;
}

export class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
  normalize = true;
}

export class FakePanner extends FakeNode {
  readonly pan = this.param('pan', 0);
}

export class FakeDelay extends FakeNode {
  readonly delayTime = this.param('delayTime', 0);

  constructor(
    ctx: FakeAudioContext,
    readonly maxDelayTime: number,
  ) {
    super(ctx, 'delay');
  }
}

export interface FakeOptions {
  /** `resume()` rejects and the context stays suspended. */
  failResume?: boolean;
  /** `resume()` returns a promise that never settles (autoplay policy). */
  hangResume?: boolean;
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  /** Every node ever created. */
  readonly nodes: FakeNode[] = [];
  /** Nodes that currently have at least one outgoing connection. */
  readonly connected = new Set<FakeNode>();
  /** Sources that were started and have not ended yet. */
  readonly running = new Set<FakeSource>();
  /** Every automation call, in call order. */
  readonly log: ParamEvent[] = [];
  /** Misuses of the API that a real context would reject or that would be audible glitches. */
  readonly violations: string[] = [];
  readonly destination: FakeNode;
  resumeCalls = 0;
  suspendCalls = 0;

  constructor(private readonly options: FakeOptions = {}) {
    this.destination = new FakeNode(this, 'destination');
  }

  fail(message: string, raise = true): void {
    this.violations.push(message);
    if (raise) throw new Error(message);
  }

  get sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }

  createGain(): FakeGain {
    return new FakeGain(this, 'gain');
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this, 'osc');
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this, 'buffer');
  }

  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this, 'biquad');
  }

  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this, 'compressor');
  }

  createConvolver(): FakeConvolver {
    return new FakeConvolver(this, 'convolver');
  }

  createStereoPanner(): FakePanner {
    return new FakePanner(this, 'panner');
  }

  createDelay(maxDelayTime = 1): FakeDelay {
    if (!(maxDelayTime > 0 && maxDelayTime < 180)) this.fail(`createDelay(${maxDelayTime})`);
    return new FakeDelay(this, maxDelayTime);
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    if (!(channels >= 1) || !(length >= 1) || !(sampleRate >= 3000)) {
      this.fail(`createBuffer(${channels}, ${length}, ${sampleRate})`);
    }
    return new FakeBuffer(channels, length, sampleRate);
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.options.hangResume) return new Promise<void>(() => undefined);
    if (this.options.failResume || this.state === 'closed') return Promise.reject(new Error('cannot resume'));
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.state === 'closed') return Promise.reject(new Error('closed'));
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  /** Moves the clock forward (only while running) and fires `ended` on sources whose stop time has passed. */
  advance(dt: number): void {
    if (this.state !== 'running') return;
    this.currentTime += dt;
    for (const s of [...this.running]) {
      if (s.stopTime !== null && s.stopTime <= this.currentTime) {
        s.ended = true;
        this.running.delete(s);
        s.onended?.();
      }
    }
  }
}

/* --------------------------------------------------------------- analysis */

/** True if a signal leaving `node` can reach the speakers (by any path, reverb and echo included). */
export function reachesOutput(node: FakeNode | FakeParam, seen = new Set<FakeNode>()): boolean {
  if (node instanceof FakeParam) return false;
  if (node.kind === 'destination') return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.outputs.some((o) => reachesOutput(o, seen));
}

/**
 * Gain from a node to the input of the master compressor along dry paths at time `t`: the product of the
 * gain nodes on the way, summed over parallel paths. Filters count as unity, reverb and echo as silence.
 */
export function dryGain(node: FakeNode | FakeParam, t: number): number {
  if (node instanceof FakeParam || node.kind === 'convolver' || node.kind === 'delay') return 0;
  if (node.kind === 'compressor' || node.kind === 'destination') return 1;
  const own = node instanceof FakeGain ? node.gain.valueAt(t) : 1;
  if (own === 0) return 0;
  let sum = 0;
  for (const o of node.outputs) sum += dryGain(o, t);
  return own * sum;
}

/** Peak amplitude a source can produce: oscillators are full scale, filtered noise is well below it. */
const weight = (s: FakeSource): number => (s instanceof FakeOscillator ? 1 : 0.5);

/**
 * Upper bound of the level fed to the master compressor at time `t`: every sounding source at the peak of
 * its waveform at once. Real peaks are lower, since partials of different frequency rarely line up.
 */
export function levelAt(sources: Iterable<FakeSource>, t: number): number {
  let sum = 0;
  for (const s of sources) {
    if (s.startTime === null || t < s.startTime || (s.stopTime !== null && t >= s.stopTime)) continue;
    sum += weight(s) * dryGain(s, t);
  }
  return sum;
}

export interface SoundReport {
  /** Number of sources. */
  count: number;
  /** Seconds from the first start to the last stop. */
  duration: number;
  /** Largest `levelAt` over the life of the sound. */
  peak: number;
  problems: string[];
}

/** Checks a group of sources (one SFX, or everything a scene scheduled) and estimates its peak level. */
export function inspect(sources: FakeSource[], t0: number, step = 0.001): SoundReport {
  const problems = checkSources(sources);
  let end = t0;
  for (const s of sources) end = Math.max(end, s.stopTime ?? t0);
  let peak = 0;
  for (let t = t0; t <= end; t += step) peak = Math.max(peak, levelAt(sources, t));
  return { count: sources.length, duration: end - t0, peak, problems };
}

/** Scheduling, click and frequency-range checks for sources that are still connected. */
export function checkSources(sources: FakeSource[]): string[] {
  const problems: string[] = [];
  for (const s of sources) {
    const id = s.kind;
    if (s.startTime === null || s.stopTime === null) {
      problems.push(`${id}: not started or never stopped`);
      continue;
    }
    if (s.stopTime <= s.startTime) problems.push(`${id}: stops before it starts`);
    const audible = reachesOutput(s);
    if (audible) {
      const tail = dryGain(s, s.stopTime);
      if (tail > 2e-3) problems.push(`${id}: stops at gain ${tail.toFixed(4)} (click)`);
      const head = dryGain(s, s.startTime);
      if (head > 2e-2) problems.push(`${id}: starts at gain ${head.toFixed(4)} (click)`);
    }
    if (s instanceof FakeOscillator) {
      const [lo, hi] = s.frequency.range();
      if (audible && (lo < 20 || hi > 16000)) problems.push(`osc: frequency ${lo.toFixed(1)}..${hi.toFixed(1)} Hz`);
      if (!audible && (lo < 0.01 || hi > 16000)) problems.push(`modulator: rate ${lo}..${hi} Hz`);
    }
  }
  return problems;
}

/** Range checks on every filter, panner and delay created so far; also triggers lazy envelope checks. */
export function auditNodes(ctx: FakeAudioContext): string[] {
  const problems: string[] = [];
  for (const n of ctx.nodes) {
    if (n instanceof FakeBiquad) {
      const [lo, hi] = n.frequency.range();
      if (lo < 20 || hi > 20000) problems.push(`biquad ${n.type}: cutoff ${lo.toFixed(1)}..${hi.toFixed(1)} Hz`);
      const [qLo, qHi] = n.Q.range();
      if (qLo <= 0 || qHi > 20) problems.push(`biquad ${n.type}: Q ${qLo}..${qHi}`);
    } else if (n instanceof FakePanner) {
      const [lo, hi] = n.pan.range();
      if (lo < -1 || hi > 1) problems.push(`panner: pan ${lo}..${hi}`);
    } else if (n instanceof FakeDelay) {
      const [lo, hi] = n.delayTime.range();
      if (lo < 0 || hi > n.maxDelayTime) problems.push(`delay: ${lo}..${hi} s`);
    } else if (n instanceof FakeGain) {
      n.gain.valueAt(Infinity);
      const [lo] = n.gain.range();
      if (lo < 0) problems.push(`gain: negative value ${lo}`);
    } else if (n instanceof FakeOscillator) {
      n.frequency.valueAt(Infinity);
    }
  }
  return problems;
}

/**
 * Static curve of the Web Audio DynamicsCompressor (the Chromium/WebKit kernel, which Firefox ports too),
 * including the automatic makeup gain. Maps a steady input amplitude to the output amplitude.
 */
export function compressorCurve(threshold: number, knee: number, ratio: number): (x: number) => number {
  const toDb = (x: number): number => 20 * Math.log10(x);
  const toLin = (db: number): number => 10 ** (db / 20);
  const linThreshold = toLin(threshold);
  const kneeCurve = (x: number, k: number): number =>
    x < linThreshold ? x : linThreshold + (1 - Math.exp(-k * (x - linThreshold))) / k;
  const kneeDb = threshold + knee;
  const kneeLin = toLin(kneeDb);
  const slopeAt = (x: number, k: number): number =>
    (toDb(kneeCurve(x * 1.001, k)) - toDb(kneeCurve(x, k))) / (toDb(x * 1.001) - toDb(x));
  let lo = 0.1;
  let hi = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeLin, k) < 1 / ratio) hi = k;
    else lo = k;
    k = Math.sqrt(lo * hi);
  }
  const yKneeDb = toDb(kneeCurve(kneeLin, k));
  const saturate = (x: number): number =>
    x < kneeLin ? kneeCurve(x, k) : toLin(yKneeDb + (toDb(x) - kneeDb) / ratio);
  const makeup = (1 / saturate(1)) ** 0.6;
  return (x) => saturate(x) * makeup;
}
