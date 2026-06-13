import {
  recommendedLength,
  accusationThreshold,
  generateBias,
  generateCodeword,
  accuse,
  packBits,
  unpackBits,
} from './src/services/fingerprint/tardos';

// Demonstrates the property that a plain per-recipient watermark cannot provide:
// even when several recipients COLLUDE to splice a mixed copy, the scheme still
// accuses a true colluder and (almost) never an innocent.

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Interleaving attack: at each bit the colluders emit one of their symbols at
// random. (Under the marking assumption, where they all agree they must emit
// that bit; where they differ they may choose — random choice models that.)
function colludeInterleave(codewords: Uint8Array[], colluders: number[]): Uint8Array {
  const m = codewords[0].length;
  const out = new Uint8Array(m);
  for (let j = 0; j < m; j++) out[j] = codewords[pick(colluders)][j];
  return out;
}

// Majority-vote attack (another standard collusion strategy).
function colludeMajority(codewords: Uint8Array[], colluders: number[]): Uint8Array {
  const m = codewords[0].length;
  const out = new Uint8Array(m);
  for (let j = 0; j < m; j++) {
    let ones = 0;
    for (const c of colluders) ones += codewords[c][j];
    out[j] = ones * 2 >= colluders.length ? 1 : 0;
  }
  return out;
}

function run(label: string, n: number, c: number, attack: (cw: Uint8Array[], col: number[]) => Uint8Array): boolean {
  const epsilon = 1e-3;
  const m = recommendedLength(c, n, epsilon);
  const threshold = accusationThreshold(m, n, epsilon);
  const bias = generateBias(m, c);
  const codewords = Array.from({ length: n }, () => generateCodeword(bias));

  // round-trip the codeword through base64 storage to exercise pack/unpack
  const stored = codewords.map((cw) => unpackBits(packBits(cw), m));

  const colluders: number[] = [];
  while (colluders.length < c) {
    const r = Math.floor(Math.random() * n);
    if (!colluders.includes(r)) colluders.push(r);
  }
  const pirated = attack(stored, colluders);

  const ranked = accuse(pirated, stored, bias, threshold);
  const top = ranked[0];
  const topIsColluder = colluders.includes(top.index);
  const accusedInnocent = ranked.some((a) => a.accused && !colluders.includes(a.index));
  const caughtAColluder = ranked.some((a) => a.accused && colluders.includes(a.index));
  const maxInnocent = Math.max(...ranked.filter((a) => !colluders.includes(a.index)).map((a) => a.score));
  const colludersScores = colluders.map((ci) => ranked.find((a) => a.index === ci)!.score);

  const ok = caughtAColluder && !accusedInnocent && topIsColluder;
  console.log(
    `${label}: n=${n} c=${c} m=${m} Z=${threshold.toFixed(0)} | ` +
      `top=#${top.index}(${top.score.toFixed(0)},${topIsColluder ? 'colluder' : 'INNOCENT'}) ` +
      `colluders=[${colludersScores.map((s) => s.toFixed(0)).join(',')}] ` +
      `maxInnocent=${maxInnocent.toFixed(0)} | ` +
      `${ok ? 'PASS' : 'FAIL'}${accusedInnocent ? ' (FALSE ACCUSATION!)' : ''}`
  );
  return ok;
}

let allPass = true;
// Repeat each scenario a few times since the codes are randomized.
for (let i = 0; i < 3; i++) allPass = run(`interleave/3`, 200, 3, colludeInterleave) && allPass;
for (let i = 0; i < 3; i++) allPass = run(`majority/3 `, 200, 3, colludeMajority) && allPass;
for (let i = 0; i < 3; i++) allPass = run(`interleave/5`, 200, 5, colludeInterleave) && allPass;

// Sanity: a single leaker (no collusion) must be caught and top-ranked.
for (let i = 0; i < 2; i++) allPass = run(`single/1   `, 200, 1, colludeInterleave) && allPass;

console.log(allPass ? '\nALL SCENARIOS PASS' : '\nSOME SCENARIOS FAILED');
process.exit(allPass ? 0 : 1);
