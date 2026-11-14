// Estado mínimo para el motor, con la misma forma que S en index.html.
export function state(over = {}) {
  return Object.assign({
    anchor: '2026-01-02', // primer cobro: catorcenas el 2-ene + 14k
    salaries: {}, extras: {}, debts: {}, pays: {}, exps: {}, cats: {},
    sep: {}, fixed: {}, goals: {}, gmoves: {}, inbox: {}, cardmap: {},
  }, over);
}

// Hoy fijo: viernes 13-nov-2026.
//   Catorcena actual (inicio del plan): 2026-11-06, luego 11-20, 12-04…
//   Catorcenas pasadas que revisa "Por pagar" (máx. 35 días atrás): 10-09 y 10-23.
export const HOY = new Date(2026, 10, 13);

// Timestamp local (como Date.now() al crear la deuda en la app).
export const ts = (y, m, d) => new Date(y, m - 1, d).getTime();
