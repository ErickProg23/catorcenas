# Catorcenas Claras
App personal de finanzas por catorcena. Un solo index.html + Firebase (compat 10.12.2),
publicada en GitHub Pages. firebase-config.js define window.FIREBASE_CONFIG.

## Reglas
- Habla en español.
- NUNCA subas respaldos JSON con datos reales al repo (es público). Agrégalos al .gitignore.
- Mantén estrictas las reglas de seguridad de Firestore.
- Trabaja en una rama, no en main.

## Motor
computeSep() calcula el plan de Separar (pend = Por pagar, ev = eventos).
Bugs ya arreglados que deben tener prueba:
- recSum cuenta todo lo separado para una fecha, incluso en catorcenas pasadas
  (si no, un abono pagado con dinero separado se descuenta doble).
- Por pagar ignora fechas anteriores a createdTs de la deuda o fijo.
- Registros skip_<id>_<key> en sepDone omiten el abono extra de esa catorcena.