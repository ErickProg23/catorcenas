// Carga el computeSep ORIGINAL (antes de separar el motor) desde una copia congelada
// del index.html de main (commit 9d3712f), para compararlo contra src/engine.js.
//
// No se reescribe nada: se extrae el texto tal cual de las funciones del <script>
// original y se evalúa con un S y una fecha de "hoy" controlados.
//
// Para comprobar que la copia es idéntica a la de main:
//   git show 9d3712f:index.html | cmp - test/legacy/index-main-9d3712f.html
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTML = readFileSync(fileURLToPath(new URL('./index-main-9d3712f.html', import.meta.url)), 'utf8');

// Lo que usa computeSep en el original (directa o indirectamente).
const FUNCS = [
  'parseDate', 'iso', 'addDays', 'today', 'days', 'periodOf', 'periodStart',
  'debtMoves', 'balanceOf', 'lastDay', 'dueList', 'sepKey', 'splitEven', 'sepK0',
  'computeSep', 'paidOccs', 'skipKey', 'snowAt', 'snowSrcNames',
  'goalList', 'goalBal', 'goalPerCatAt', 'goalProjection',
];
const CONSTS = ['HORIZON', 'cents'];

// Devuelve el índice justo después de la llave que cierra el bloque que abre en `open`.
// Respeta strings ('…', "…", `…`) y comentarios para no contar llaves dentro de ellos.
function blockEnd(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  throw new Error('Llave sin cerrar');
}

function extractFunction(src, name) {
  const re = new RegExp('^function ' + name + '\\(', 'gm');
  const m = re.exec(src);
  if (!m) throw new Error('No se encontró function ' + name + ' en el index.html original');
  if (re.exec(src)) throw new Error('function ' + name + ' aparece más de una vez');
  return src.slice(m.index, blockEnd(src, src.indexOf('{', m.index)));
}

function extractConst(src, name) {
  const m = new RegExp('^const ' + name + '=.*;$', 'm').exec(src);
  if (!m) throw new Error('No se encontró const ' + name + ' en el index.html original');
  return m[0];
}

const CODE = [...CONSTS.map(n => extractConst(HTML, n)), ...FUNCS.map(n => extractFunction(HTML, n))].join('\n');

// El original lee el estado global S y la fecha con today() (= new Date()).
// Aquí S se pasa como parámetro y Date se reemplaza por una cuyo "ahora" es fijo.
const factory = new Function('S', 'Date', CODE + '\nreturn { computeSep };');

export function legacyComputeSep(S, now) {
  const nowMs = now.getTime();
  class FixedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(nowMs); }
    static now() { return nowMs; }
  }
  return factory(S, FixedDate).computeSep();
}
