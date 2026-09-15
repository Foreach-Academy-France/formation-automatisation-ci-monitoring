# Cheatsheet — Prometheus, PromQL & Grafana

> ForEach Academy — Formation Automatisation CI & Monitoring — Formateur : Fabrice Claeys

---

## 1. Concepts

| Terme | Définition |
|---|---|
| **Target** | Endpoint HTTP scrapé (`host:port/metrics`) |
| **Job** | Groupe de targets de même nature (`taskflow-api`, `node-vms`) |
| **Scrape** | Collecte périodique (**pull**) par le serveur, `scrape_interval` (15 s par défaut dans le cours) |
| **Série temporelle** | `nom_metrique{label="valeur", ...}` → suite de (timestamp, valeur) |
| **Exporter** | Programme qui traduit un système (OS, nginx, conteneurs) en `/metrics` |
| **TSDB** | Stockage local, rétention par défaut 15 jours (`--storage.tsdb.retention.time=30d`) |
| **Cardinalité** | Nombre de séries = produit des valeurs de labels ; jamais d'ID utilisateur / URL brute en label |
| `up` | Métrique synthétique : 1 si le scrape a réussi, 0 sinon |

Modèle de données : **une métrique + des labels = une série**. Convention de nommage : `<domaine>_<quoi>_<unité>` avec unités de base (`_seconds`, `_bytes`), suffixe `_total` pour les counters.

## 2. Format `/metrics`

```
# HELP http_requests_total Nombre total de requêtes HTTP
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/tasks",status_code="200"} 1027
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{route="/api/tasks",le="0.05"} 980
http_request_duration_seconds_bucket{route="/api/tasks",le="+Inf"} 1027
http_request_duration_seconds_sum{route="/api/tasks"} 12.4
http_request_duration_seconds_count{route="/api/tasks"} 1027
# TYPE taskflow_tasks_total gauge
taskflow_tasks_total 12
```

## 3. Les 4 types de métriques

| Type | Sens | Exploitation | Exemple |
|---|---|---|---|
| **Counter** | ne fait que croître (reset au redémarrage) | `rate()`, `increase()` | `http_requests_total`, `node_cpu_seconds_total` |
| **Gauge** | monte et descend | valeur brute, `avg_over_time()`, `predict_linear()` | `node_memory_MemAvailable_bytes`, `taskflow_tasks_total` |
| **Histogram** | répartition en buckets cumulés (`_bucket{le}`, `_sum`, `_count`) | `histogram_quantile()`, moyenne = `_sum/_count` | `http_request_duration_seconds` |
| **Summary** | quantiles calculés côté client (`{quantile="0.95"}`) | lecture directe, non agrégeable entre instances | `go_gc_duration_seconds` |

## 4. `prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/rules/*.yml

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

scrape_configs:
  - job_name: prometheus
    static_configs: [{ targets: ['localhost:9090'] }]

  - job_name: taskflow-api
    metrics_path: /metrics
    static_configs:
      - targets: ['192.168.64.11:80']
        labels: { env: staging }
      - targets: ['192.168.64.12:80']
        labels: { env: prod }

  - job_name: node-vms
    static_configs:
      - targets: ['192.168.64.11:9100']
        labels: { env: staging }
      - targets: ['192.168.64.12:9100']
        labels: { env: prod }

  - job_name: cadvisor
    static_configs: [{ targets: ['cadvisor:8080'] }]

  - job_name: blackbox                 # sonde HTTP externe
    metrics_path: /probe
    params: { module: [http_2xx] }
    static_configs:
      - targets: ['http://192.168.64.11/health', 'http://192.168.64.12/health']
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target     # l'URL devient le paramètre ?target=
      - source_labels: [__param_target]
        target_label: instance           # et le label instance
      - target_label: __address__
        replacement: blackbox-exporter:9115   # on scrape l'exporter, pas l'URL
```

Découverte dynamique (au lieu de `static_configs`) : `file_sd_configs` (fichiers JSON/YAML rechargés à chaud), `docker_sd_configs`, `kubernetes_sd_configs`, `ec2_sd_configs`…

Rechargement sans redémarrer : `curl -X POST localhost:9090/-/reload` (nécessite `--web.enable-lifecycle`).

## 5. PromQL

### Sélecteurs et matchers

```promql
http_requests_total                                  # toutes les séries
http_requests_total{env="prod"}                      # égalité
http_requests_total{status_code=~"5.."}              # regex (ancrée)
http_requests_total{route!="/metrics"}               # différent
http_requests_total{env="prod"}[5m]                  # range vector (5 min de points)
http_requests_total offset 1h                        # valeur il y a 1 h
```

### Fonctions sur counters (toujours sur un range vector)

```promql
rate(http_requests_total[5m])        # dérivée moyenne /s sur 5 min (gère les resets)
irate(http_requests_total[5m])       # dérivée instantanée (2 derniers points) — graphes fins
increase(http_requests_total[1h])    # augmentation totale sur 1 h
```

Règle : fenêtre `[…]` ≥ 4 × `scrape_interval` (15 s → au moins 1 m, 5 m conseillé).

### Agrégations

```promql
sum(rate(http_requests_total[5m]))                       # total
sum by (env) (rate(http_requests_total[5m]))             # par environnement
sum without (instance) (rate(http_requests_total[5m]))   # tout sauf instance
avg / min / max / count / topk(3, …) / bottomk / stddev
```

### Histogrammes

```promql
histogram_quantile(0.95, sum by (le, env) (rate(http_request_duration_seconds_bucket[5m])))
# moyenne :
sum(rate(http_request_duration_seconds_sum[5m])) / sum(rate(http_request_duration_seconds_count[5m]))
```

`le` doit toujours survivre à l'agrégation.

### Opérateurs et fonctions diverses

```promql
a / b                      # arithmétique entre vecteurs (labels identiques)
a / on(env) group_left b   # jointure sur un sous-ensemble de labels
a > 0.05                   # filtre (garde les séries dont la valeur > 0.05)
a > bool 0.05              # renvoie 0/1
absent(up{job="taskflow-api"})            # 1 si aucune série n'existe
predict_linear(node_filesystem_avail_bytes[1h], 4*3600)   # extrapolation linéaire
avg_over_time(taskflow_tasks_total[1h]) / max_over_time / min_over_time
changes(process_start_time_seconds[1h])   # nombre de redémarrages
delta(gauge[1h])                          # variation d'un gauge
time() - process_start_time_seconds       # uptime en secondes
label_replace(v, "dst", "$1", "src", "(.*)")
```

## 6. Les 15 requêtes à connaître

**RED — application (API TaskFlow)**

```promql
# 1. Requêtes par seconde, par environnement
sum by (env) (rate(http_requests_total[5m]))
# 2. Taux d'erreur 5xx (ratio 0..1)
sum by (env) (rate(http_requests_total{status_code=~"5.."}[5m]))
  / sum by (env) (rate(http_requests_total[5m]))
# 3. Latence p95
histogram_quantile(0.95, sum by (le, env) (rate(http_request_duration_seconds_bucket[5m])))
# 4. Latence moyenne
sum(rate(http_request_duration_seconds_sum[5m])) / sum(rate(http_request_duration_seconds_count[5m]))
# 5. Routes les plus lentes (p95 par route)
topk(5, histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m]))))
# 6. Métrique métier
taskflow_tasks_total
```

**USE — infrastructure (node_exporter)**

```promql
# 7. CPU utilisé (%)
100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100
# 8. Mémoire utilisée (%)
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100
# 9. Disque utilisé (%) sur /
(1 - node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}
     / node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}) * 100
# 10. Disque plein dans 4 h ?
predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[1h], 4*3600) < 0
# 11. Trafic réseau entrant (octets/s)
sum by (instance) (rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*"}[5m]))
# 12. Load average 5 min rapporté au nombre de CPU
node_load5 / count by (instance) (node_cpu_seconds_total{mode="idle"})
```

**Conteneurs et disponibilité**

```promql
# 13. CPU par conteneur (cAdvisor)
sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[5m]))
# 14. Mémoire par conteneur
container_memory_working_set_bytes{name!=""}
# 15. Disponibilité externe (blackbox) et durée de la sonde
probe_success            # 1 = OK
probe_duration_seconds
```

## 7. Exporters et ports par défaut

| Exporter | Port | Métriques clés |
|---|---|---|
| Prometheus | 9090 | `up`, `prometheus_tsdb_*` |
| Alertmanager | 9093 | `alertmanager_alerts` |
| node_exporter | 9100 | `node_cpu_seconds_total`, `node_memory_*`, `node_filesystem_*`, `node_network_*` |
| cAdvisor | 8080 (8081 dans le lab) | `container_cpu_usage_seconds_total`, `container_memory_working_set_bytes`, `container_last_seen` |
| blackbox_exporter | 9115 | `probe_success`, `probe_http_status_code`, `probe_ssl_earliest_cert_expiry` |
| nginx-prometheus-exporter | 9113 | `nginx_connections_active`, `nginx_http_requests_total` |
| postgres_exporter | 9187 | `pg_up`, `pg_stat_*` |
| Grafana | 3000 (3001 dans le lab) | `/metrics` natif |
| Pushgateway | 9091 | jobs batch éphémères |
| Loki / Promtail | 3100 / 9080 | logs |

## 8. Instrumenter en Node.js (`prom-client`)

```js
import client from 'prom-client'

export const register = new client.Registry()
client.collectDefaultMetrics({ register })          // CPU, mémoire, event loop, GC

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requêtes HTTP',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP en secondes',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
})
export const tasksGauge = new client.Gauge({
  name: 'taskflow_tasks_total', help: 'Nombre de tâches en mémoire', registers: [register],
})

export function metricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer()
  res.on('finish', () => {
    const route = req.route?.path ?? req.path      // route déclarée, pas l'URL brute (cardinalité)
    const labels = { method: req.method, route, status_code: res.statusCode }
    httpRequests.inc(labels)
    end(labels)
  })
  next()
}

export async function metricsHandler(_req, res) {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
}
```

Équivalents : **Micrometer** (Spring Boot Actuator `/actuator/prometheus`), **prometheus_client** (Python, `start_http_server`), **promhttp** (Go).

## 9. Grafana — provisioning as code

`grafana/provisioning/datasources/prometheus.yml` :

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

`grafana/provisioning/dashboards/dashboards.yml` :

```yaml
apiVersion: 1
providers:
  - name: taskflow
    folder: TaskFlow
    type: file
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
```

Compose : monter `./grafana/provisioning:/etc/grafana/provisioning` et `./grafana/provisioning/dashboards/json:/var/lib/grafana/dashboards`. Exporter un dashboard : *Share → Export → Save to file* (cocher *Export for sharing externally*) puis committer le JSON.

Variables de dashboard : `env` = `label_values(http_requests_total, env)` → requêtes avec `{env=~"$env"}`.

Annotations par API (job `annotate-grafana`) :

```bash
curl -fsS -X POST "$GRAFANA_URL/api/annotations" \
  -H "Authorization: Bearer $GRAFANA_TOKEN" -H "Content-Type: application/json" \
  -d '{"tags":["deploy","prod"],"text":"Déploiement v'"$VERSION"' — run '"$RUN_URL"'"}'
```

Token : *Administration → Service accounts → Add* (rôle Editor) → *Add token*.

Raccourcis utiles : `e` (éditer le panel), `v` (plein écran), `d + k` (kiosk), `t + z` (zoom out), `Ctrl + S` (sauver). Dashboards communautaires : **1860** (Node Exporter Full), **14282** (cAdvisor), **7587** (blackbox), **12708** (Node.js prom-client).

## 10. Commandes utiles

```bash
promtool check config prometheus.yml
promtool check rules rules/taskflow.yml
promtool query instant http://localhost:9090 'up'
curl -s 'localhost:9090/api/v1/query?query=up' | jq
curl -s localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health}'
curl -X POST localhost:9090/-/reload
```
