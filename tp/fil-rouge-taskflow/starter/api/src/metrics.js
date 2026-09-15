/**
 * Instrumentation Prometheus de l'API TaskFlow — À COMPLÉTER AU JOUR 3.
 *
 * Objectif (TP3, étape 2) : exposer sur GET /metrics, au format Prometheus :
 *   1. les métriques par défaut de prom-client (process_*, nodejs_*)
 *   2. les métriques HTTP « RED » :
 *        - http_requests_total{method, route, status_code}         (Counter)
 *        - http_request_duration_seconds{method, route, status_code} (Histogram,
 *          buckets [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2])
 *   3. une métrique métier : taskflow_tasks_total (Gauge)
 *
 * Contraintes :
 *   - utiliser un Registry dédié (pas le registre global) → testable
 *   - normaliser la route (/api/tasks/:id/toggle, jamais l'id réel) → cardinalité
 *   - mesurer à l'événement `finish` de la réponse (status code connu)
 *
 * `prom-client` est déjà dans package.json : `import client from 'prom-client'`
 * Le contrat exporté (utilisé par app.js) ne doit pas changer :
 *   register, metricsMiddleware, metricsHandler, setTasksGauge
 */

// TODO J3 : import client from 'prom-client'
// TODO J3 : export const register = new client.Registry()
// TODO J3 : client.collectDefaultMetrics({ register })
// TODO J3 : déclarer le Counter, l'Histogram et la Gauge

export const register = null

/** Met à jour la gauge métier (appelée par app.js à chaque modification). */
export function setTasksGauge(_value) {
  // TODO J3
}

/** Middleware Express : mesure chaque requête (compteur + histogramme). */
export function metricsMiddleware(_req, _res, next) {
  // TODO J3 : startTimer() puis res.on('finish', …)
  next()
}

/** Handler de GET /metrics : expose le registre au format texte Prometheus. */
export async function metricsHandler(_req, res) {
  // TODO J3 : res.set('Content-Type', register.contentType) ; res.send(await register.metrics())
  res
    .status(501)
    .type('text/plain')
    .send('# API non instrumentée : voir api/src/metrics.js (TP3)\n')
}
