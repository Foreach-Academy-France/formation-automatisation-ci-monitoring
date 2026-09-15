/**
 * Instrumentation Prometheus de l'API TaskFlow (J3).
 *
 * Trois familles de métriques :
 *   1. Métriques par défaut de prom-client (CPU process, mémoire, event loop, GC…)
 *   2. Métriques HTTP « RED » : Rate (compteur), Errors (status_code), Duration (histogramme)
 *   3. Métrique métier : nombre de tâches en mémoire (gauge)
 *
 * Conventions de nommage Prometheus :
 *   - suffixe `_total` pour les compteurs
 *   - unités de base dans le nom (`_seconds`, `_bytes`)
 *   - labels à faible cardinalité (route normalisée, PAS l'id de la tâche !)
 */
import client from 'prom-client'

// Un registre dédié plutôt que le registre global : évite les doublons
// quand l'application est instanciée plusieurs fois (tests).
export const register = new client.Registry()

// Label commun à toutes les métriques (utile pour distinguer plusieurs services)
register.setDefaultLabels({ app: 'taskflow-api' })

// 1. Métriques par défaut (process_*, nodejs_*)
client.collectDefaultMetrics({ register })

// 2. Métriques HTTP
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requêtes HTTP reçues',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP en secondes',
  labelNames: ['method', 'route', 'status_code'],
  // Buckets adaptés à une API rapide : de 5 ms à 2 s
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
})

// 3. Métrique métier
export const tasksTotal = new client.Gauge({
  name: 'taskflow_tasks_total',
  help: 'Nombre de tâches actuellement stockées',
  registers: [register],
})

/** Met à jour la gauge métier (appelée par app.js à chaque modification). */
export function setTasksGauge(value) {
  tasksTotal.set(value)
}

/**
 * Normalise le chemin pour limiter la cardinalité :
 *   /api/tasks/abc123/toggle → /api/tasks/:id/toggle
 * Si Express a matché une route, `req.route.path` est déjà normalisé.
 */
function normalizeRoute(req) {
  if (req.route?.path) {
    return req.baseUrl + req.route.path
  }
  return req.path.replace(/\/[0-9a-z]{8,}(?=\/|$)/gi, '/:id')
}

/**
 * Middleware Express : mesure chaque requête (compteur + histogramme).
 * Les métriques sont enregistrées à la fin de la réponse (`finish`),
 * moment où le status code est connu.
 */
export function metricsMiddleware(req, res, next) {
  const endTimer = httpRequestDurationSeconds.startTimer()

  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: normalizeRoute(req),
      status_code: String(res.statusCode),
    }
    httpRequestsTotal.inc(labels)
    endTimer(labels)
  })

  next()
}

/** Handler de la route GET /metrics : expose le registre au format texte Prometheus. */
export async function metricsHandler(_req, res) {
  res.set('Content-Type', register.contentType)
  res.send(await register.metrics())
}
