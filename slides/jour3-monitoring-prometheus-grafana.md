---
marp: true
theme: uncover
paginate: true
footer: M2 ESTD - Automatisation CI & Monitoring | ForEach Academy
style: |
  section {
    font-size: 20px;
    padding: 40px 50px;
  }
  h1 { font-size: 36px; color: #E6522C; margin: 0 0 15px 0; }
  h2 { font-size: 28px; color: #9f3316; margin: 0 0 12px 0; }
  h3 { font-size: 24px; color: #f97316; margin: 0 0 10px 0; }
  code { font-size: 18px; background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
  table { font-size: 16px; }
  blockquote { border-left: 4px solid #f97316; padding-left: 15px; font-style: italic; color: #4b5563; margin: 10px 0; font-size: 18px; }
  ul { margin: 10px 0; padding-left: 25px; }
  li { margin-bottom: 5px; line-height: 1.3; }
  pre { font-size: 15px; padding: 20px; margin: 15px 0; background: #1e1e1e !important; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
  pre code { background: transparent !important; color: #d4d4d4; font-size: 15px; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
---

<!-- _class: lead -->
# Jour 3 — Introduction au monitoring : Prometheus & Grafana

**Automatisation du système CI & Monitoring**
M2 — ForEach Academy

Formateur : Fabrice Claeys

---

## Programme du Jour 3

| Créneau | Contenu |
|---------|---------|
| 09h00 – 09h45 | Pourquoi et quoi monitorer : KPI, golden signals, SLI/SLO |
| 09h45 – 11h00 | Prometheus : architecture, modèle de données, PromQL |
| **11h00 – 11h15** | **Pause** |
| 11h15 – 11h45 | Instrumenter une application (`prom-client`) |
| 11h45 – 12h15 | Grafana : dashboards et provisioning as code |
| **12h15 – 13h15** | **Pause déjeuner** |
| 13h15 – 17h00 | **TP3** : Monitorer TaskFlow (stack Prometheus + Grafana) |

---

## Où en est-on dans la chaîne ?

```
 commit ──► build ──► test ──► déploiement ──► monitoring ──► alerte
   J1         J1       J1          J2            J3  ◄──        J4
```

- **J1** : CI factorisé (workflow réutilisable, runner self-hosted)
- **J2** : TaskFlow (front + API) déployée sur `taskflow-web1` (staging) et `taskflow-web2` (prod) par Ansible, depuis le workflow `deploy.yml`
- **Aujourd'hui** : on sait *déployer* sans humain… mais on ne sait pas encore si ça **marche** une fois en prod.

> Un déploiement automatisé sans monitoring, c'est conduire de nuit sans phares.

---

<!-- _class: lead -->
# Pourquoi et quoi monitorer ?

---

## Monitoring vs observabilité

| | Monitoring | Observabilité |
|--|-----------|---------------|
| **Question** | « Est-ce que ça va ? » | « *Pourquoi* ça ne va pas ? » |
| **Approche** | Questions connues à l'avance (seuils, checks) | Explorer l'inconnu à partir des données émises |
| **Données** | Métriques + alertes | Métriques + logs + traces (les **3 piliers**) |

```
   MÉTRIQUES              LOGS                     TRACES
   (chiffres dans         (événements              (parcours d'une
    le temps)              horodatés)               requête)
   "p95 = 320 ms"         "ERROR task not found"   "API → DB : 210 ms"
```

> Ce cours porte sur les **métriques** (Prometheus). Les logs (Loki) sont abordés en bonus au J4.

---

## À quoi sert le monitoring ?

| Objectif | Exemple TaskFlow |
|----------|------------------|
| **Détecter** | L'API répond 502 depuis 3 minutes → alerte |
| **Diagnostiquer** | La latence a explosé juste après le déploiement n°42 |
| **Planifier la capacité** | Le disque de `taskflow-web2` sera plein dans 4 heures |
| **Prouver** | « Nous avons tenu 99,7 % de disponibilité ce mois-ci » (SLA) |

- Sans monitoring : ce sont les **utilisateurs** qui détectent les pannes
- Avec monitoring : l'équipe est **prévenue avant** (proactif) et peut **mesurer** l'impact

---

## KPI et indicateurs clés

| Indicateur | Ce qu'il mesure | Unité typique |
|-----------|-----------------|---------------|
| **Disponibilité** (uptime) | Le service répond-il ? | % sur une période |
| **Latence** | Temps de réponse — p50, **p95**, p99 | ms |
| **Taux d'erreur** | Part des requêtes en échec (5xx) | % |
| **Débit** (throughput) | Requêtes traitées | req/s |
| **Saturation** | Utilisation des ressources | % CPU, % RAM, % disque |

> **Pourquoi p95 et pas la moyenne ?** Une moyenne de 100 ms peut cacher 5 % d'utilisateurs qui attendent 3 secondes. Le p95 dit : « 95 % des requêtes sont plus rapides que X ».

---

## Les 4 golden signals (Google SRE)

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   LATENCY    │   TRAFFIC    │    ERRORS    │  SATURATION  │
│  Combien de  │  Combien de  │  Combien     │  À quel      │
│  temps ?     │  demandes ?  │  échouent ?  │  point est-  │
│              │              │              │  on plein ?  │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

- Si vous ne pouvez mesurer que 4 choses sur un service, mesurez celles-là
- Distinguer la latence des requêtes **réussies** de celle des requêtes en **erreur** (une 500 rapide n'est pas une bonne nouvelle)

---

## Méthodes USE et RED

<div class="columns">
<div>

### USE — pour l'infrastructure
*(Brendan Gregg)*

- **U**tilization : % du temps occupé
- **S**aturation : file d'attente, swap
- **E**rrors : erreurs matérielles / OS

→ CPU, mémoire, disque, réseau

</div>
<div>

### RED — pour les services
*(Tom Wilkie)*

- **R**ate : requêtes / seconde
- **E**rrors : requêtes en échec / seconde
- **D**uration : distribution des latences

→ API TaskFlow, nginx

</div>
</div>

> Dans le TP : dashboard **RED** pour l'API TaskFlow, dashboard **USE** (node_exporter) pour les VMs.

---

## SLI, SLO, SLA

| Terme | Définition | Exemple TaskFlow |
|-------|-----------|------------------|
| **SLI** *(Indicator)* | La mesure | `% de requêtes /api/* en 2xx/3xx` ; `p95 latence` |
| **SLO** *(Objective)* | La cible interne | disponibilité **≥ 99,5 %** / 30 j ; **p95 < 300 ms** |
| **SLA** *(Agreement)* | Le contrat (avec pénalités) | 99 % / mois, sinon avoir |

```
SLO 99,5 % sur 30 jours  →  budget d'erreur = 0,5 % × 30 j × 24 h = 3 h 36 min
```

- **Error budget** : le temps d'indisponibilité « autorisé ». Tant qu'il en reste, on déploie ; s'il est consommé, on gèle les mises en prod et on fiabilise.
- Le SLO est toujours **plus strict** que le SLA : marge de sécurité

---

## Boîte noire vs boîte blanche

<div class="columns">
<div>

### Boîte noire (blackbox)
- Observer **de l'extérieur**, comme un utilisateur
- `curl http://taskflow-web1/health` toutes les 15 s
- Ping, TLS, temps de réponse HTTP
- Outil : **blackbox_exporter** (J4)

✅ Détecte les pannes visibles
❌ N'explique pas pourquoi

</div>
<div>

### Boîte blanche (whitebox)
- Observer **de l'intérieur** : l'application expose ses propres métriques
- `/metrics` : compteurs, histogrammes, mémoire, event loop
- Outil : **prom-client** dans l'API (aujourd'hui)

✅ Diagnostic précis, métriques métier
❌ Il faut instrumenter le code

</div>
</div>

> Les deux sont complémentaires : la boîte noire alerte, la boîte blanche explique.

---

## À retenir — Pourquoi monitorer

- Le monitoring répond à « est-ce que ça va ? » ; l'observabilité à « pourquoi ? »
- **4 golden signals** : latence, trafic, erreurs, saturation
- **RED** pour les services, **USE** pour l'infra
- **SLI → SLO → SLA** ; l'error budget arbitre entre vitesse de livraison et fiabilité
- Mesurer les **percentiles**, pas les moyennes
- Combiner **blackbox** (symptômes vus de l'extérieur) et **whitebox** (instrumentation)

---

<!-- _class: lead -->
# Prometheus

---

## Panorama des outils de monitoring

| Outil | Modèle | Ce qu'il surveille | Remarque |
|-------|--------|--------------------|----------|
| **Nagios / Icinga** | Checks (OK/WARN/CRIT), push/plugins | État des hôtes et services | Historique, orienté « est-ce up ? » |
| **Zabbix** | Agents + serveur | Infra, métriques | Complet mais lourd |
| **Prometheus** | **Pull** de métriques, séries temporelles | Tout ce qui expose `/metrics` | Standard cloud-native (CNCF) |
| **Datadog / New Relic** | SaaS, agents | Tout (métriques, logs, traces, APM) | Facturation au volume |
| **Grafana Cloud** | SaaS (Prometheus/Loki/Tempo managés) | Tout | Même stack qu'ici, hébergée |

> Prometheus : créé chez SoundCloud en 2012, 2e projet gradué de la CNCF après Kubernetes. Le **format d'exposition** est devenu un standard (OpenMetrics).

---

## Le modèle pull

```
┌──────────────────────┐   HTTP GET /metrics (toutes les 15 s)
│      PROMETHEUS      │ ───────────────────────────────────►  API TaskFlow :3000
│  ┌────────────────┐  │ ───────────────────────────────────►  node_exporter :9100
│  │  TSDB (disque) │  │ ───────────────────────────────────►  cAdvisor :8080
│  └────────────────┘  │ ───────────────────────────────────►  blackbox :9115
│   PromQL  ◄── UI/API │
└──────────────────────┘
```

- Prometheus **va chercher** (scrape) les métriques : la cible n'a rien à envoyer
- Avantages : Prometheus sait si une cible est **injoignable** (`up == 0`), configuration centralisée, pas de saturation par les clients
- **Pushgateway** : uniquement pour les jobs éphémères (batch, cron) qui n'existent plus au moment du scrape

---

## Architecture Prometheus

| Composant | Rôle |
|-----------|------|
| **Serveur Prometheus** | Scrape, stocke (TSDB), évalue les règles, sert PromQL |
| **Targets** | Endpoints `/metrics` à scraper, déclarés dans `scrape_configs` ou découverts (**service discovery** : DNS, fichiers, Kubernetes, EC2…) |
| **Exporters** | Traduisent un système existant en métriques : node_exporter (OS), cAdvisor (conteneurs), nginx, postgres, blackbox… |
| **Client libraries** | Instrumentation directe : `prom-client` (Node), Micrometer (Java), `prometheus_client` (Python, Go) |
| **Alertmanager** | Reçoit les alertes, les groupe, les route (J4) |
| **Grafana** | Visualise (Prometheus n'a qu'une UI de debug) |

- **TSDB** locale : ~1-2 octets par échantillon compressé, rétention par défaut **15 jours** (`--storage.tsdb.retention.time=30d`)

---

## `prometheus.yml` — la configuration

```yaml
global:
  scrape_interval: 15s          # fréquence de scrape par défaut
  evaluation_interval: 15s      # fréquence d'évaluation des règles

rule_files:
  - /etc/prometheus/rules/*.yml # règles d'alerte et recording rules (J4)

scrape_configs:
  - job_name: prometheus        # Prometheus se surveille lui-même
    static_configs:
      - targets: ['localhost:9090']

  - job_name: taskflow-api
    metrics_path: /metrics      # défaut : /metrics
    static_configs:
      - targets: ['192.168.64.11:80']
        labels: { env: staging }
      - targets: ['192.168.64.12:80']
        labels: { env: prod }
```

> Chaque `job_name` devient un label `job` ; chaque target un label `instance`. Les labels ajoutés dans `static_configs` (ici `env`) sont attachés à **toutes** les séries de la cible.

---

## Le modèle de données

Une **série temporelle** = un nom de métrique + un ensemble de labels → une suite de `(timestamp, valeur)`

```
http_requests_total{method="GET", route="/api/tasks", status_code="200", env="prod"}  1523
http_requests_total{method="POST", route="/api/tasks", status_code="201", env="prod"}   87
http_requests_total{method="GET", route="/api/tasks", status_code="200", env="staging"} 412
└──────┬─────────┘└──────────────────────────┬──────────────────────────────────────┘ └─┬─┘
  nom de métrique                          labels (dimensions)                        valeur
```

- Les **labels** permettent de filtrer et d'agréger (« par env », « par route »)
- Chaque combinaison de labels distincte = **une série** de plus

> Convention : nom en `snake_case`, préfixe par domaine (`http_`, `node_`, `taskflow_`), suffixe d'unité (`_seconds`, `_bytes`) et `_total` pour les compteurs.

---

## Les 4 types de métriques

| Type | Sémantique | Exemple | Requête typique |
|------|-----------|---------|-----------------|
| **Counter** | Ne fait qu'**augmenter** (reset au redémarrage) | `http_requests_total` | `rate(...[5m])` |
| **Gauge** | Valeur qui monte et descend | `taskflow_tasks_total`, `node_memory_MemAvailable_bytes` | valeur brute, `avg_over_time` |
| **Histogram** | Distribution en **buckets** cumulatifs + `_sum` + `_count` | `http_request_duration_seconds` | `histogram_quantile(0.95, ...)` |
| **Summary** | Quantiles calculés **côté client** | `rpc_duration_seconds{quantile="0.9"}` | non agrégeable → préférer histogram |

```
http_request_duration_seconds_bucket{le="0.1"}   950   ← 950 requêtes ≤ 100 ms
http_request_duration_seconds_bucket{le="0.5"}  1180
http_request_duration_seconds_bucket{le="+Inf"} 1200   ← toutes
http_request_duration_seconds_sum               142.7
http_request_duration_seconds_count             1200
```

---

## Le piège de la cardinalité

> **Cardinalité** = nombre de séries distinctes. Chaque série coûte de la RAM et du disque.

```
❌ http_requests_total{user_id="4f8a…"}       → 1 série par utilisateur (millions)
❌ http_requests_total{route="/api/tasks/9x2k"} → 1 série par ID de tâche
✅ http_requests_total{route="/api/tasks/:id"}  → route normalisée
```

Règles :
- Jamais de label avec des valeurs **non bornées** (ID, e-mail, IP client, URL complète, timestamp)
- Quelques dizaines de valeurs par label maximum
- `count({__name__=~".+"})` dans Prometheus pour surveiller le nombre de séries

---

## Le format d'exposition `/metrics`

```
# HELP http_requests_total Nombre total de requêtes HTTP
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/tasks",status_code="200"} 1523
http_requests_total{method="POST",route="/api/tasks",status_code="201"} 87

# HELP taskflow_tasks_total Nombre de tâches en mémoire
# TYPE taskflow_tasks_total gauge
taskflow_tasks_total 12

# HELP process_resident_memory_bytes Resident memory size in bytes.
# TYPE process_resident_memory_bytes gauge
process_resident_memory_bytes 58281984
```

- Texte brut, une ligne par série, lisible avec `curl http://localhost:3000/metrics`
- `# HELP` et `# TYPE` documentent la métrique
- C'est tout ce qu'une application doit produire pour être « compatible Prometheus »

---

## Les exporters standards

| Exporter | Port | Ce qu'il expose | Quand |
|----------|------|-----------------|-------|
| **node_exporter** | 9100 | CPU, RAM, disque, réseau, load de l'OS Linux | Sur **chaque VM** (déployé par Ansible aujourd'hui) |
| **cAdvisor** | 8080 | CPU/RAM/réseau/restarts **par conteneur** | Hôtes Docker (J4) |
| **blackbox_exporter** | 9115 | HTTP/TCP/ICMP/DNS vus de l'extérieur | Sondes de disponibilité (J4) |
| **nginx-prometheus-exporter** | 9113 | Connexions, requêtes nginx (`stub_status`) | Bonus TP3 |
| **postgres_exporter**, **redis_exporter**, **mysqld_exporter** | 9187, 9121, 9104 | Métriques des bases | Selon la stack |

> Plus de 200 exporters recensés : [prometheus.io/docs/instrumenting/exporters](https://prometheus.io/docs/instrumenting/exporters/). Avant d'instrumenter, vérifier qu'un exporter n'existe pas déjà.

---

<!-- _class: lead -->
# PromQL

---

## Sélecteurs et matchers

```promql
# Toutes les séries de la métrique
http_requests_total

# Filtrer par labels (égalité, différence, regex)
http_requests_total{env="prod"}
http_requests_total{status_code!="200"}
http_requests_total{status_code=~"5.."}
http_requests_total{route!~"/health|/metrics"}

# Vecteur de plage (range vector) : les 5 dernières minutes de chaque série
http_requests_total{env="prod"}[5m]
```

| Type de résultat | Description |
|------------------|-------------|
| **Instant vector** | Une valeur par série, à l'instant T (ce que Grafana trace) |
| **Range vector** | Une suite de valeurs par série, sur une fenêtre `[5m]` — entrée de `rate()` |
| **Scalar** | Un nombre |

---

## `rate()` et `increase()` — les compteurs

Un compteur brut n'est **jamais** intéressant : ce qui compte, c'est sa **vitesse**.

```promql
# Requêtes par seconde, moyennées sur 5 min (gère les resets du compteur)
rate(http_requests_total[5m])

# Nombre de requêtes sur la fenêtre (= rate × durée)
increase(http_requests_total[1h])

# irate : basé sur les 2 derniers points seulement — plus nerveux, pour les graphes fins
irate(http_requests_total[1m])
```

Règles :
- **Toujours** `rate()` sur un counter, jamais sur une gauge
- La fenêtre `[5m]` doit contenir **au moins 4 scrapes** (avec 15 s → 1 min minimum, 5 min confortable)
- `rate()` avant `sum()`, jamais l'inverse (`sum(rate(...))` ✅, `rate(sum(...))` ❌)

---

## Agrégations

```promql
# Total requêtes/s toutes séries confondues
sum(rate(http_requests_total[5m]))

# Par environnement
sum(rate(http_requests_total[5m])) by (env)

# Par route et statut, en gardant tout sauf instance
sum(rate(http_requests_total[5m])) without (instance)

# Autres agrégateurs
avg(...)  min(...)  max(...)  count(...)  topk(5, ...)  bottomk(3, ...)
```

- `by (labels)` : conserve uniquement ces labels
- `without (labels)` : conserve tous les autres
- Les opérateurs arithmétiques (`/`, `*`, `-`) s'appliquent entre vecteurs **aux labels identiques**

---

## `histogram_quantile()` — les latences

```promql
# p95 de la latence, par environnement, sur 5 min
histogram_quantile(
  0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, env)
)
```

- Fonctionne sur les buckets `_bucket` d'un **histogram**
- Il faut **toujours** conserver le label `le` dans le `by (...)`
- La précision dépend des buckets choisis à l'instrumentation (d'où les buckets `[0.005 … 2]` dans l'API)
- Latence **moyenne** (moins utile) :

```promql
rate(http_request_duration_seconds_sum[5m]) / rate(http_request_duration_seconds_count[5m])
```

---

## `up` et `absent()` — la santé des cibles

```promql
# 1 si le dernier scrape a réussi, 0 sinon — générée automatiquement pour chaque target
up
up{job="taskflow-api"} == 0            # cibles injoignables

# absent() vaut 1 si AUCUNE série ne correspond (métrique disparue, target supprimée…)
absent(up{job="taskflow-api", env="prod"})

# Depuis combien de temps la cible n'a pas été vue
time() - max_over_time(timestamp(up{job="taskflow-api"})[1h:])
```

> `up` est la première métrique à regarder : si la cible n'est pas scrapée, **toutes** les autres métriques sont absentes — et une alerte « taux d'erreur » ne se déclenchera jamais. `absent()` couvre ce cas (J4).

---

## Les 10 requêtes à connaître

| # | Question | PromQL |
|---|----------|--------|
| 1 | Cibles en panne | `up == 0` |
| 2 | Requêtes/s par env | `sum(rate(http_requests_total[5m])) by (env)` |
| 3 | Taux d'erreur 5xx | `sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))` |
| 4 | Latence p95 | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` |
| 5 | CPU % par VM | `100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100` |
| 6 | RAM utilisée % | `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100` |
| 7 | Disque libre % | `node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100` |
| 8 | Réseau entrant | `rate(node_network_receive_bytes_total{device!="lo"}[5m])` |
| 9 | Top 5 routes | `topk(5, sum(rate(http_requests_total[5m])) by (route))` |
| 10 | Métrique disparue | `absent(up{job="taskflow-api"})` |

---

## Démo live — Prometheus en 5 minutes

```bash
cd monitoring
docker compose up -d prometheus node-exporter
open http://localhost:9090
```

1. **Status → Targets** : `prometheus` et `node-local` en `UP`, dernier scrape, durée
2. **Graph** : taper `up`, puis `node_memory_MemAvailable_bytes`
3. `rate(node_cpu_seconds_total{mode="idle"}[1m])` → onglet *Graph*
4. **Status → Configuration** : la config chargée ; **Status → Rules** : vide pour l'instant
5. `curl localhost:9100/metrics | head -40` : voir le format brut

> Prometheus recharge sa configuration avec `curl -X POST localhost:9090/-/reload` (flag `--web.enable-lifecycle`) ou `docker compose restart prometheus`.

---

## À retenir — Prometheus

- Modèle **pull** : Prometheus scrape des endpoints `/metrics` en texte brut
- Une série = **nom + labels** ; attention à la **cardinalité**
- 4 types : **counter** (→ `rate()`), **gauge**, **histogram** (→ `histogram_quantile()`), summary
- `up` dit si la cible répond ; `absent()` dit si une série a disparu
- PromQL : `rate()` puis `sum() by (...)`, `histogram_quantile(0.95, ... by (le))`
- Les **exporters** couvrent l'OS, les conteneurs, les bases ; l'application s'instrumente avec une **client library**

---

<!-- _class: lead -->
# Instrumenter une application

---

## Les bibliothèques clientes

| Langage | Bibliothèque | Intégration typique |
|---------|-------------|---------------------|
| **Node.js** | `prom-client` | Middleware Express / Fastify, route `/metrics` |
| **Java / Spring** | **Micrometer** (+ Spring Boot Actuator) | `/actuator/prometheus` en 1 dépendance |
| **Python** | `prometheus_client` | Middleware Flask/Django, `start_http_server()` |
| **Go** | `prometheus/client_golang` | `promhttp.Handler()` |
| **.NET** | `prometheus-net` | Middleware ASP.NET |

Toutes offrent la même chose :
- un **registre** de métriques
- les 4 types (Counter, Gauge, Histogram, Summary)
- des **métriques par défaut** du runtime (mémoire, GC, CPU, event loop, threads)
- une fonction qui sérialise le registre au format texte

---

## Que faut-il exposer ?

| Catégorie | Métriques | Type |
|-----------|----------|------|
| **RED du service** | `http_requests_total{method,route,status_code}` | counter |
| | `http_request_duration_seconds{method,route}` | histogram |
| **Métier** | `taskflow_tasks_total` (tâches en mémoire) | gauge |
| | `taskflow_tasks_created_total` | counter |
| **Runtime** (par défaut) | `process_cpu_seconds_total`, `process_resident_memory_bytes`, `nodejs_eventloop_lag_seconds`, `nodejs_gc_duration_seconds` | fournis par `collectDefaultMetrics()` |
| **Build** | `taskflow_build_info{version="42", env="prod"} 1` | gauge (valeur 1, labels = info) |

> Les métriques **métier** sont souvent les plus précieuses : « 0 tâche créée depuis 10 min alors qu'il y a du trafic » est un signal qu'aucune métrique technique ne donne.

---

## `prom-client` dans l'API TaskFlow — `api/src/metrics.js`

```js
import client from 'prom-client'

export const register = new client.Registry()
client.collectDefaultMetrics({ register })          // CPU, RAM, event loop, GC…

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total', help: 'Nombre total de requêtes HTTP',
  labelNames: ['method', 'route', 'status_code'], registers: [register],
})
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds', help: 'Durée des requêtes HTTP',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2], registers: [register],
})
export const tasksGauge = new client.Gauge({
  name: 'taskflow_tasks_total', help: 'Nombre de tâches en mémoire', registers: [register],
})
```

---

## Le middleware et la route `/metrics`

```js
// api/src/metrics.js (suite)
export function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer()          // chrono
  res.on('finish', () => {
    const route = req.route?.path ?? req.path            // "/api/tasks/:id" et non "/api/tasks/9x2k"
    const labels = { method: req.method, route, status_code: res.statusCode }
    httpRequestsTotal.inc(labels)
    end(labels)                                          // observe la durée dans l'histogramme
  })
  next()
}

export async function metricsHandler(_req, res) {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
}
```

```js
// api/src/app.js
app.use(metricsMiddleware)          // AVANT les routes : mesure tout, y compris les 404
app.get('/metrics', metricsHandler)
```

---

## Bien nommer ses métriques

| Règle | ✅ | ❌ |
|-------|----|----|
| `snake_case`, préfixe de domaine | `taskflow_tasks_total` | `TasksCount` |
| Unité de **base** dans le nom | `_seconds`, `_bytes` | `_ms`, `_kb` |
| `_total` pour les compteurs | `http_requests_total` | `http_requests` |
| Labels = dimensions **bornées** | `route="/api/tasks/:id"` | `route="/api/tasks/9x2k"` |
| Une métrique = une chose | `http_request_duration_seconds` | `http_stats` |
| Pas d'info dans le nom qui devrait être un label | `http_requests_total{method="GET"}` | `http_get_requests_total` |

- `promtool check metrics < metrics.txt` vérifie les conventions (lint)
- Ne pas confondre **label** (`status_code="500"`) et **valeur** : le compteur compte, le label qualifie

---

## Démo live — instrumenter en 15 lignes

```bash
cd api && npm install prom-client
# éditer src/metrics.js (slide précédente) et brancher dans app.js
npm start &
curl -s localhost:3000/api/tasks >/dev/null; curl -s localhost:3000/api/tasks >/dev/null
curl -s localhost:3000/metrics | grep -E "^http_requests_total|^taskflow_tasks_total"
```

```
http_requests_total{method="GET",route="/api/tasks",status_code="200"} 2
taskflow_tasks_total 0
```

- Redémarrer l'API : le compteur repart de 0 → `rate()` gère les resets
- Test unitaire avec `supertest` : `GET /metrics` renvoie 200 et contient `http_requests_total` → le workflow réutilisable (J1) l'exécute à chaque push

---

## À retenir — Instrumentation

- Chaque langage a sa **client library** ; le format de sortie est le même
- Un **middleware** HTTP suffit pour obtenir le RED : counter + histogram avec labels `method`, `route`, `status_code`
- Normaliser la **route** (`/:id`), jamais l'URL brute
- Ajouter des **métriques métier** (gauge/counter) : elles racontent ce que fait réellement le service
- `collectDefaultMetrics()` donne gratuitement mémoire, CPU, event loop
- Nommage : `snake_case`, unité de base, `_total`

---

<!-- _class: lead -->
# Grafana

---

## Grafana en quelques mots

- Plateforme de **visualisation** open source (2014), indépendante de la source de données
- **Datasources** : Prometheus, Loki, Elasticsearch, PostgreSQL, CloudWatch… (plus de 150)
- **Dashboards** composés de **panels** ; **variables** pour filtrer ; **annotations** pour marquer des événements ; alertes (unifiées) en option
- Dans le lab : `http://localhost:3001` (admin / admin), provisionné automatiquement

```
┌──────────────────────────────────────────────────────┐
│ Grafana                                              │
│  ┌───────────────┐  ┌────────────────────────────┐   │
│  │ Datasource     │  │ Dashboard "TaskFlow RED"   │   │
│  │ Prometheus     │◄─┤  panel req/s  panel p95    │   │
│  │ :9090          │  │  panel erreurs  panel tâches│   │
│  └───────────────┘  └────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

---

## Les types de panels

| Panel | Usage | Exemple TaskFlow |
|-------|-------|------------------|
| **Time series** | Évolution dans le temps (le plus courant) | requêtes/s par env, p95 |
| **Stat** | Une valeur, grande, colorée par seuil | taux d'erreur actuel, uptime |
| **Gauge** | Jauge avec min/max | % disque utilisé |
| **Bar gauge** | Comparer plusieurs valeurs | requêtes par route |
| **Table** | Données tabulaires (dernières valeurs) | état des targets `up` |
| **State timeline** | États discrets dans le temps | up/down par instance |
| **Logs** | Lignes de logs (Loki) | erreurs de l'API (bonus J4) |

Chaque panel : une requête PromQL, une **unité** (`reqps`, `s`, `percent`, `bytes`), des **seuils** (vert / orange / rouge), une **légende** (`{{env}}`).

---

## Variables et annotations

**Variables** : rendre un dashboard réutilisable

```
Nom : env      Type : Query     Requête : label_values(http_requests_total, env)
Utilisation dans les panels : sum(rate(http_requests_total{env=~"$env"}[5m]))
```

- Sélecteur en haut du dashboard : `staging` / `prod` / `All`
- Autres variables utiles : `instance`, `route`, intervalle `$__rate_interval` (adapte la fenêtre de `rate()` au zoom)

**Annotations** : marquer des événements sur les graphes

- Ligne verticale « déploiement v42 — 14:32 » sur tous les panels
- Poussées par l'API Grafana (`POST /api/annotations`) depuis le workflow `deploy.yml` (J4)
- Permet de **corréler** un changement de courbe avec un déploiement

---

## Provisioning as code — datasources

Tout ce qu'on clique dans l'UI peut être décrit en **fichiers**, chargés au démarrage :

```yaml
# monitoring/grafana/provisioning/datasources/prometheus.yml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus                 # référencé par les dashboards JSON
    access: proxy
    url: http://prometheus:9090     # nom du service dans docker-compose
    isDefault: true
    editable: false
```

```yaml
# monitoring/docker-compose.yml (extrait)
grafana:
  image: grafana/grafana:11.1.0
  ports: ["3001:3000"]
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin
  volumes:
    - ./grafana/provisioning:/etc/grafana/provisioning
```

---

## Provisioning as code — dashboards

```yaml
# monitoring/grafana/provisioning/dashboards/dashboards.yml
apiVersion: 1
providers:
  - name: taskflow
    folder: TaskFlow
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards/json
```

```
monitoring/grafana/provisioning/dashboards/json/
├── taskflow-red.json           ← exporté depuis l'UI (Share → Export → Save to file)
└── node-exporter-basic.json    ← CPU / RAM / disque / réseau par instance
```

- Le JSON est **versionné dans Git** : revue, historique, reproductible sur n'importe quel Grafana
- Workflow : concevoir dans l'UI → exporter → committer → Grafana recharge

---

## Importer un dashboard communautaire

[grafana.com/grafana/dashboards](https://grafana.com/grafana/dashboards/) : des milliers de dashboards prêts à l'emploi, identifiés par un **ID**.

| ID | Dashboard | Pour |
|----|-----------|------|
| **1860** | Node Exporter Full | Les VMs (node_exporter) — la référence |
| 14282 | cAdvisor exporter | Conteneurs Docker |
| 7587 | Prometheus Blackbox Exporter | Sondes HTTP |
| 3662 | Prometheus 2.0 Overview | Prometheus lui-même |

Dans l'UI : **Dashboards → New → Import → ID 1860 → datasource Prometheus → Import**.

> Pour le versionner : après import, *Export → Save to file* puis déposer le JSON dans `provisioning/dashboards/json/` (retirer le champ `"id"`, garder `"uid"`).

---

## Qu'est-ce qu'un bon dashboard ?

| ✅ | ❌ |
|----|----|
| Une **question** par panel (« combien d'erreurs ? ») | Un « mur de graphes » sans titre |
| Hiérarchie : **vue d'ensemble** en haut (stat), **détail** en dessous | 40 panels au même niveau |
| **Unités** partout (`reqps`, `ms`, `%`) | Axes sans unité |
| **Seuils** visuels alignés sur les SLO (p95 rouge > 300 ms) | Couleurs décoratives |
| Légendes lisibles (`{{env}} {{route}}`) | `{instance="192.168.64.11:80", job=...}` |
| Variables (`$env`) pour un seul dashboard réutilisable | Un dashboard copié par environnement |
| Fenêtre de `rate()` = `$__rate_interval` | `[1m]` figé qui casse au dézoom |

> Un dashboard sert à **répondre vite** pendant un incident. S'il faut 30 secondes pour trouver l'info, il est raté.

---

## Démo live — dashboard « TaskFlow RED » en 10 minutes

1. **New dashboard → Add visualization → Prometheus**
2. Panel *Stat* « Requêtes/s » : `sum(rate(http_requests_total{env=~"$env"}[$__rate_interval]))`, unité `reqps`
3. Panel *Stat* « Erreurs 5xx » : ratio 5xx / total, unité `percentunit`, seuils 1 % / 5 %
4. Panel *Time series* « p95 par env » : `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{env=~"$env"}[$__rate_interval])) by (le, env))`, unité `s`, seuil 0,3
5. Panel *Gauge* « Tâches » : `taskflow_tasks_total`
6. Variable `env` : `label_values(http_requests_total, env)`
7. **Save** → **Share → Export → Save to file** → `taskflow-red.json` → commit

> Générer du trafic pour voir bouger les courbes : `for i in $(seq 1 200); do curl -s http://192.168.64.11/api/tasks >/dev/null; done`

---

## À retenir — Grafana

- Grafana **visualise**, Prometheus **stocke et calcule** : ne pas confondre les rôles
- Panels : *time series* pour les tendances, *stat*/*gauge* pour l'état, avec **unités** et **seuils**
- **Variables** (`$env`) et `$__rate_interval` rendent un dashboard réutilisable
- **Provisioning as code** : datasources et dashboards en fichiers, JSON versionné dans Git
- Importer les dashboards communautaires (1860) plutôt que tout refaire
- **Annotations** : relier les courbes aux déploiements (J4)

---

<!-- _class: lead -->
# TP de l'après-midi

---

## TP3 — Monitorer TaskFlow (3h45)

| Étape | Contenu | Durée |
|-------|---------|-------|
| 1 | Stack `monitoring/docker-compose.yml` : Prometheus + Grafana + node_exporter local ; targets `UP` | 30 min |
| 2 | Instrumenter `api/` avec `prom-client` : middleware, gauge métier, `/metrics`, test unitaire (exécuté par le CI) | 1h |
| 3 | Rôle Ansible `node_exporter` + workflow `monitoring.yml` (`workflow_dispatch` + push sur `ansible/roles/node_exporter/**`) : déploiement sur les 2 VMs depuis le runner | 45 min |
| 4 | `prometheus.yml` : jobs `taskflow-api` (staging/prod, label `env`) et `node-vms` ; requêtes PromQL (req/s, erreurs, p95, CPU/RAM/disque) | 45 min |
| 5 | Grafana provisionné : datasource, dashboard « TaskFlow RED », import 1860, JSON committé | 45 min |
| Bonus | Générer du trafic et observer p95 ; nginx exporter | — |

**Livrable** : stack monitoring versionnée, API instrumentée, VMs sous node_exporter déployé par workflow, 2 dashboards provisionnés.

---

## Ce que le TP3 ajoute à la chaîne

```
  taskflow-ops (GitHub)
  ├── api/src/metrics.js               ← prom-client
  ├── ansible/roles/node_exporter/     ← déployé par…
  ├── .github/workflows/monitoring.yml ← …ce workflow (runner self-hosted)
  └── monitoring/
      ├── docker-compose.yml            Prometheus :9090  Grafana :3001
      ├── prometheus/prometheus.yml     jobs taskflow-api, node-vms
      └── grafana/provisioning/         datasource + dashboards JSON

  Prometheus ──scrape──► taskflow-web1:80/metrics   (env=staging)
             ──scrape──► taskflow-web2:80/metrics   (env=prod)
             ──scrape──► taskflow-web1:9100         (node_exporter)
             ──scrape──► taskflow-web2:9100
```

> Demain : on transforme ces métriques en **alertes** et on ferme la boucle avec le déploiement.

---

## Synthèse du Jour 3

- Le monitoring commence par **une question** : quel SLI, quel SLO ?
- **Golden signals / RED / USE** : le vocabulaire commun des équipes
- **Prometheus** : pull, séries temporelles avec labels, PromQL (`rate`, `sum by`, `histogram_quantile`)
- **Instrumenter** = un middleware et quelques métriques métier
- **Grafana** : dashboards provisionnés en code, variables, unités, seuils
- Tout est **dans le repo** : la stack de monitoring se déploie comme l'application

---

<!-- _class: lead -->
# Questions ?

**Demain — Jour 4** : surveillance de l'infrastructure, règles d'alerte, Alertmanager et notifications, annotations de déploiement, bonnes pratiques… et QCM final.

Formateur : Fabrice Claeys — ForEach Academy
