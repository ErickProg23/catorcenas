import { describe, it, expect } from 'vitest';
import E from '../src/engine.js';
import { state, HOY, ts } from './fixtures.js';

const { computeSep, sepKey, skipKey } = E;

const itemsFor = (plan, id, key) =>
  Object.values(plan).flat().filter(it => it.id === id && it.key === key);

describe('computeSep: calendario base', () => {
  it('el plan arranca en la catorcena actual', () => {
    const { P } = computeSep(state(), HOY);
    expect(P[0]).toBe('2026-11-06');
    expect(P[1]).toBe('2026-11-20');
    expect(P).toHaveLength(E.HORIZON + 3);
  });
});

describe('Bug 1 · recSum cuenta lo separado en catorcenas pasadas', () => {
  // Pago mensual de 1000 el día 25. Para el del 25-nov separaste 400 en la catorcena
  // pasada (23-oct) y con eso hiciste un abono de 400 ligado a esa fecha.
  // Faltan 600, que se reparten en las catorcenas del 6-nov y 20-nov.
  // Con el bug, los 400 se descontaban dos veces (como abono y como "ya separado")
  // y el plan pedía solo 200.
  const S = state({
    debts: { d1: { name: 'Préstamo', kind: 'loan', base: 5000, baseTs: 1, freq: 'monthly', day1: 25, amount: 1000, createdTs: ts(2026, 11, 1) } },
    sep: { [sepKey('2026-10-23', 'd1', '2026-11-25')]: { payday: '2026-10-23', debtId: 'd1', due: '2026-11-25', amount: 400 } },
    pays: { p1: { debtId: 'd1', amount: 400, date: '2026-10-30', ts: 2, occ: 'd1|2026-11-25' } },
  });

  it('lo que falta separar es 600, no 200', () => {
    const { plan } = computeSep(S, HOY);
    const its = itemsFor(plan, 'd1', '2026-11-25');
    expect(its.map(i => i.payday)).toEqual(['2026-11-06', '2026-11-20']);
    expect(its.reduce((s, i) => s + i.share, 0)).toBe(600);
    expect(its[0].toPay).toBe(600);
    expect(its[0].paidAmt).toBe(400);
  });

  it('no muestra los 400 como "ya tenías separado" (se usaron en el abono)', () => {
    const { plan } = computeSep(S, HOY);
    expect(itemsFor(plan, 'd1', '2026-11-25')[0].already).toBe(0);
  });
});

describe('Bug 2 · Por pagar ignora fechas anteriores a createdTs', () => {
  it('una deuda creada el 1-nov no reclama el pago del 15-oct', () => {
    const S = state({
      debts: { d1: { name: 'Tarjeta', kind: 'card', base: 8000, baseTs: 1, freq: 'monthly', day1: 15, amount: 700, createdTs: ts(2026, 11, 1) } },
    });
    const { pending } = computeSep(S, HOY);
    expect(pending.filter(p => p.id === 'd1')).toEqual([]);
  });

  it('una deuda sin createdTs (vieja) sí reclama el pago del 15-oct', () => {
    const S = state({
      debts: { d1: { name: 'Tarjeta', kind: 'card', base: 8000, baseTs: 1, freq: 'monthly', day1: 15, amount: 700 } },
    });
    const { pending } = computeSep(S, HOY);
    expect(pending.filter(p => p.id === 'd1').map(p => p.due)).toEqual(['2026-10-15']);
  });

  it('un pago fijo por catorcena creado el 20-oct solo reclama la catorcena del 23-oct', () => {
    const S = state({
      fixed: { g1: { name: 'Gym', amount: 300, freq: 'catorcena', createdTs: ts(2026, 10, 20) } },
    });
    const { pending } = computeSep(S, HOY);
    expect(pending.filter(p => p.id === 'f-g1').map(p => p.due)).toEqual(['2026-10-23']);
  });
});

describe('Bug 3 · skip_<id>_<key> omite el abono extra de esa catorcena', () => {
  // Deuda con abono extra de 500 por catorcena.
  const debt = { name: 'Préstamo', kind: 'loan', base: 20000, baseTs: 1, freq: 'monthly', day1: 28, amount: 1000, extra: 500, createdTs: ts(2026, 1, 1) };
  const S = state({
    debts: { d1: debt },
    sep: {
      [skipKey('d1', 'x2026-11-06')]: { skip: true, id: 'd1', key: 'x2026-11-06', ts: 1 },
      [skipKey('d1', 'x2026-10-23')]: { skip: true, id: 'd1', key: 'x2026-10-23', ts: 1 },
    },
  });

  it('en el plan, el extra de esa catorcena sale omitido y en 0', () => {
    const { plan } = computeSep(S, HOY);
    const [it6] = itemsFor(plan, 'd1', 'x2026-11-06');
    expect(it6).toMatchObject({ skipped: true, share: 0, toPay: 0, amount: 500 });
  });

  it('la siguiente catorcena (sin skip) sí lleva el extra completo', () => {
    const { plan } = computeSep(S, HOY);
    const [it20] = itemsFor(plan, 'd1', 'x2026-11-20');
    expect(it20.skipped).toBeUndefined();
    expect(it20.share).toBe(500);
  });

  it('en Por pagar, el extra omitido de una catorcena pasada no aparece', () => {
    const { pending } = computeSep(S, HOY);
    const extras = pending.filter(p => p.id === 'd1' && p.kind === 'extra').map(p => p.key);
    expect(extras).toEqual(['x2026-10-09']);
  });
});
