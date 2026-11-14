// Prueba de caracterización: el computeSep original (index.html de main) y el de
// src/engine.js deben dar EXACTAMENTE el mismo resultado con los mismos datos.
// Todos los datos son inventados.
import { describe, it, expect } from 'vitest';
import E from '../src/engine.js';
import { legacyComputeSep } from './legacy/loadLegacy.js';
import { state, ts } from './fixtures.js';

const { sepKey, skipKey } = E;

// Catorcenas (anchor 2026-01-02): …10-09, 10-23, 11-06, 11-20, 12-04, 12-18…
function escenario() {
  return state({
    debts: {
      // Préstamo mensual (día 25) con abono extra de 500 por catorcena.
      prestamo: {
        name: 'Préstamo coche', kind: 'loan', base: 15000, baseTs: ts(2026, 9, 1),
        freq: 'monthly', day1: 25, amount: 1000, extra: 500, createdTs: ts(2026, 1, 1),
      },
      // Tarjeta quincenal (días 5 y 20) creada a MITAD de catorcena (11-10, dentro de 11-06…11-19).
      tarjeta: {
        name: 'Tarjeta azul', kind: 'card', base: 9000, baseTs: ts(2026, 11, 10),
        freq: 'biweekly', day1: 5, day2: 20, amount: 600, createdTs: ts(2026, 11, 10),
      },
      // Préstamo cada 28 días, creado a mitad de catorcena (10-15, dentro de 10-09…10-22).
      // Saldo chico: se liquida dentro del horizonte.
      corto: {
        name: 'Préstamo amigo', kind: 'loan', base: 2000, baseTs: ts(2026, 10, 15),
        freq: 'interval', every: 28, next: '2026-11-18', amount: 800, createdTs: ts(2026, 10, 15),
        snows: [{ from: '2026-12-04', amount: 300, srcName: 'Tarjeta roja' }],
      },
      // Sin frecuencia: va a "skipped".
      sinFecha: { name: 'Deuda sin fecha', kind: 'loan', base: 3000, baseTs: 1, createdTs: ts(2026, 2, 1) },
      // Mismo nombre que otra (préstamo vs tarjeta) para probar las etiquetas.
      dup: {
        name: 'Préstamo coche', kind: 'card', base: 4000, baseTs: 1,
        freq: 'monthly', day1: 31, amount: 450, createdTs: ts(2026, 3, 1),
      },
    },
    pays: {
      // Abono completo del 25-oct, ligado a esa fecha.
      a1: { debtId: 'prestamo', amount: 1000, date: '2026-10-25', ts: ts(2026, 10, 25), occ: 'prestamo|2026-10-25' },
      // Abono parcial de 400 del 25-nov, hecho con dinero separado en la catorcena pasada.
      a2: { debtId: 'prestamo', amount: 400, date: '2026-10-30', ts: ts(2026, 10, 30), occ: 'prestamo|2026-11-25' },
      // Abono del extra de la catorcena del 10-09.
      a3: { debtId: 'prestamo', amount: 500, date: '2026-10-12', ts: ts(2026, 10, 12), occ: 'prestamo|x2026-10-09' },
      // Abono suelto (sin occ) a la tarjeta: solo baja el saldo.
      a4: { debtId: 'tarjeta', amount: 250, date: '2026-11-12', ts: ts(2026, 11, 12) },
      // Abono anterior al último "Corregir saldo": no cuenta.
      a5: { debtId: 'prestamo', amount: 999, date: '2026-08-01', ts: ts(2026, 8, 1) },
    },
    exps: {
      // Compra con la tarjeta (suma al saldo).
      e1: { method: 'credit', cardId: 'tarjeta', amount: 1200, date: '2026-11-11', ts: ts(2026, 11, 11) },
      // Compra con la tarjeta marcada para NO sumarse.
      e2: { method: 'credit', cardId: 'tarjeta', amount: 300, date: '2026-11-11', ts: ts(2026, 11, 11), toDebt: false },
      // Pago del teléfono de noviembre, ligado a su fecha.
      e3: { method: 'debit', amount: 350, date: '2026-11-03', ts: ts(2026, 11, 3), occ: 'f-tel|2026-11-03' },
    },
    sep: {
      // Lo que separaste en la catorcena pasada para el 25-nov (y luego abonaste).
      [sepKey('2026-10-23', 'prestamo', '2026-11-25')]: { payday: '2026-10-23', debtId: 'prestamo', due: '2026-11-25', amount: 400 },
      // Lo separado en la catorcena actual para el 25-dic.
      [sepKey('2026-11-06', 'prestamo', '2026-12-25')]: { payday: '2026-11-06', debtId: 'prestamo', due: '2026-12-25', amount: 300 },
      // Abono extra omitido en una catorcena pasada y en una futura.
      [skipKey('prestamo', 'x2026-10-23')]: { skip: true, id: 'prestamo', key: 'x2026-10-23', ts: 1 },
      [skipKey('prestamo', 'x2026-11-20')]: { skip: true, id: 'prestamo', key: 'x2026-11-20', ts: 1 },
      // Pasaste 100 del pago del 25-dic del préstamo de la catorcena del 4-dic a la del 18-dic.
      ['mv_2026-12-04_prestamo_2026-12-25']: { move: true, id: 'prestamo', key: '2026-12-25', from: '2026-12-04', to: '2026-12-18', amount: 100 },
      // El gym del 23-oct lo pagaste por fuera.
      ['paid_f-gym_2026-10-23']: { paidExt: true, occ: 'f-gym|2026-10-23', date: '2026-10-24' },
    },
    fixed: {
      // Gym por catorcena, creado a mitad de catorcena (10-28, dentro de 10-23…11-05).
      gym: { name: 'Gym', amount: 300, freq: 'catorcena', createdTs: ts(2026, 10, 28) },
      tel: { name: 'Teléfono', amount: 350, freq: 'monthly', day1: 3, createdTs: ts(2026, 1, 5) },
      luz: { name: 'Luz', amount: 520, freq: 'interval', every: 28, next: '2026-11-27', createdTs: ts(2026, 6, 1) },
      cero: { name: 'Sin monto', amount: 0, freq: 'monthly', day1: 10, createdTs: ts(2026, 6, 1) },
    },
    goals: {
      viaje: {
        name: 'Viaje', target: 6000, base: 1000, baseTs: ts(2026, 9, 1), perCat: 700, from: '2026-11-06', createdTs: ts(2026, 9, 1),
        feeds: [{ from: '2026-12-18', amount: 200 }],
        aportes: [{ date: '2026-12-10', amount: 1000 }, { date: '2026-10-01', amount: 999 }],
      },
    },
    gmoves: {
      // Lo guardado de la catorcena actual, ligado a su fecha.
      m1: { goalId: 'viaje', amount: 700, ts: ts(2026, 11, 7), date: '2026-11-07', occ: 'g-viaje|v2026-11-06' },
    },
  });
}

// Varios "hoy": a mitad de catorcena, último día, primer día, cruce de año.
// Con hora del día para que el original tenga que truncarla con today().
const HOYS = [
  [2026, 11, 13], [2026, 11, 19], [2026, 11, 20], [2026, 12, 3], [2026, 12, 31], [2027, 1, 2],
];

describe('Caracterización: computeSep de main == src/engine.js', () => {
  it.each(HOYS)('hoy = %i-%i-%i', (y, m, d) => {
    const ahora = new Date(y, m - 1, d, 15, 37, 12);
    const hoy = new Date(y, m - 1, d);
    const original = legacyComputeSep(escenario(), ahora);
    const motor = E.computeSep(escenario(), hoy);
    expect(motor).toStrictEqual(original);
  });

  it('también con sepStart posterior a hoy', () => {
    const S = () => Object.assign(escenario(), { sepStart: '2026-12-04' });
    const ahora = new Date(2026, 10, 13, 9, 0);
    expect(E.computeSep(S(), new Date(2026, 10, 13))).toStrictEqual(legacyComputeSep(S(), ahora));
  });

  // Que la comparación no sea trivial: el escenario sí ejercita los casos pedidos.
  it('el escenario cubre deudas, abonos, extra omitido y deuda creada a mitad de catorcena', () => {
    const { plan, pending, skipped } = legacyComputeSep(escenario(), new Date(2026, 10, 13, 12));
    const items = Object.values(plan).flat();
    const ids = new Set(items.map(i => i.id));
    for (const id of ['prestamo', 'tarjeta', 'corto', 'dup', 'f-gym', 'f-tel', 'f-luz', 'g-viaje']) expect(ids).toContain(id);
    expect(skipped).toEqual(['Deuda sin fecha']);
    expect(items.some(i => i.id === 'prestamo' && i.key === 'x2026-11-20' && i.skipped)).toBe(true); // extra omitido
    expect(items.some(i => i.id === 'prestamo' && i.paidAmt === 400)).toBe(true);                       // abono parcial
    expect(items.some(i => i.id === 'prestamo' && i.movedOut > 0)).toBe(true);                           // movido
    expect(items.some(i => i.liq)).toBe(true);                                                           // se liquida
    expect(items.some(i => i.snow)).toBe(true);                                                          // bola de nieve
    expect(pending.length).toBeGreaterThan(0);
    // Deuda creada el 10-nov: sin pagos vencidos en Por pagar.
    expect(pending.filter(p => p.id === 'tarjeta')).toEqual([]);
  });
});
