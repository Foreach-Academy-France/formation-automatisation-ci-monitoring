# TP Jour 3 : Monitorer TaskFlow avec Prometheus et Grafana

> **Durée** : ~3h45 | **Objectif** : Mettre en place une stack Prometheus + Grafana, instrumenter l'API TaskFlow avec `prom-client`, déployer `node_exporter` sur les deux VMs par un workflow Ansible, écrire les requêtes PromQL des indicateurs RED/USE et provisionner un premier dashboard versionné.

---

## Prérequis

- TP2 terminé : TaskFlow (front + API) déployée sur `taskflow-web1` (staging) et `taskflow-web2` (prod) par `deploy.yml`
- Docker Compose v2 sur le poste
- Les IP des VMs sous la main (`multipass list`)

---

## Étape 1 : Lancer la stack de monitoring (30 min)

### 1.1 Le compose

Le starter fournit `monitoring/docker-compose.yml` avec trois services. Vérifiez-le :

```yaml
services:
  prometheus:
    image: prom/prometheus:v2.53.0
    container_name: prometheus
    ports: ["9090:9090"]
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./prometheus/rules:/etc/prometheus/rules:ro
      - prometheus-data:/prometheus
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.retention.time=15d
      - --web.enable-lifecycle          # autorise POST /-/reload
    extra_hosts:
      - host.docker.internal:host-gateway   # pour scraper le poste hôte si besoin
    networks: [monitoring]

  grafana:
    image: grafana/grafana:11.1.0
    container_name: grafana
    ports: ["3001:3000"]
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_USERS_ALLOW_SIGN_UP: "false"
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - ./grafana/provisioning/dashboards/json:/var/lib/grafana/dashboards:ro
      - grafana-data:/var/lib/grafana
    networks: [monitoring]

  node-exporter:
    image: prom/node-exporter:v1.8.2
    container_name: node-exporter
    ports: ["9100:9100"]
    command: ['--path.rootfs=/host']
    volumes: ['/:/host:ro,rslave']
    networks: [monitoring]

volumes:
  prometheus-data:
  grafana-data:

networks:
  monitoring:
```

### 1.2 Démarrer

```bash
cd ~/taskflow-ops/monitoring
docker compose up -d
docker compose ps
```

**Résultat attendu :** trois conteneurs `running`. Ouvrez :

- Prometheus : http://localhost:9090 → **Status → Targets** : le job `prometheus` est `UP`
- Grafana : http://localhost:3001 (`admin` / `admin`) → **Connections → Data sources** : *Prometheus* est déjà là (provisionné par `grafana/provisioning/datasources/prometheus.yml`)

### 1.3 Ajouter le node_exporter local

Dans `monitoring/prometheus/prometheus.yml`, ajoutez au bloc `scrape_configs` :

```yaml
  - job_name: node-local
    static_configs:
      - targets: ['node-exporter:9100']
        labels:
          env: lab
```

```bash
curl -X POST http://localhost:9090/-/reload      # grâce à --web.enable-lifecycle
```

**Résultat attendu :** la target `node-local` passe `UP`. Dans l'onglet *Graph*, tapez `node_memory_MemAvailable_bytes` : la mémoire disponible de votre poste s'affiche.

> Sous Docker Desktop (macOS/Windows), le node_exporter conteneurisé voit la VM Docker, pas votre machine. Ce n'est pas grave : les métriques « vraies » viendront des VMs à l'étape 3.

---

## Étape 2 : Instrumenter l'API avec `prom-client` (1h)

Actuellement `GET /metrics` renvoie `501 Not instrumented`. Vous allez exposer les **métriques RED** de l'API.

### 2.1 Le module `metrics.js`

Remplacez `api/src/metrics.js` :

```js
/**
 * Instrumentation Prometheus de l'API TaskFlow (prom-client).
 * Expose les métriques RED : Rate, Errors, Duration + une gauge métier.
 */
import client from 'prom-client'

// Registre dédié : évite de mélanger avec un éventuel registre global d'une autre lib
export const register = new client.Registry()

// Métriques par défaut de Node : CPU process, mémoire, event loop lag, GC…
client.collectDefaultMetrics({ register })

// R — Rate : nombre de requêtes, par méthode / route / code HTTP
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requêtes HTTP',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

// D — Duration : histogramme des latences (en secondes, unité de base Prometheus)
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP en secondes',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
})

// Gauge métier : combien de tâches en mémoire en ce moment
export const tasksGauge = new client.Gauge({
  name: 'taskflow_tasks_total',
  help: 'Nombre de tâches actuellement stockées',
  registers: [register],
})

export function setTasksGauge(n) {
  tasksGauge.set(n)
}

/** Middleware Express : mesure chaque requête (y compris les 404). */
export function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer()
  res.on('finish', () => {
    // req.route n'existe que si une route a matché : sinon on garde le chemin brut
    // (attention à la cardinalité : jamais d'ID dans le label route !)
    const route = req.route?.path ?? req.path
    const labels = { method: req.method, route, status_code: res.statusCode }
    httpRequestsTotal.inc(labels)
    end(labels)
  })
  next()
}

/** Handler de GET /metrics : format texte Prometheus. */
export async function metricsHandler(_req, res) {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
}
```

### 2.2 Brancher dans `app.js`

Dans `api/src/app.js`, vérifiez (ou ajoutez) :

```js
import { metricsMiddleware, metricsHandler, setTasksGauge } from './metrics.js'
// …
app.use(metricsMiddleware)          // AVANT les routes
// …
app.get('/metrics', metricsHandler) // remplace le 501
```

et, après chaque modification de la liste des tâches (`POST`, `DELETE`, `PATCH`), appelez `setTasksGauge(tasks.length)`.

### 2.3 Tester en local

```bash
cd ~/taskflow-ops/api
npm ci
npm start &
curl -s localhost:3000/api/tasks -X POST -H 'Content-Type: application/json' -d '{"text":"Tester les métriques"}'
curl -s localhost:3000/metrics | grep -E '^(http_requests_total|taskflow_tasks_total|http_request_duration_seconds_bucket\{.*le="0.1")'
kill %1
```

**Résultat attendu :**

```
http_requests_total{method="POST",route="/api/tasks",status_code="201"} 1
http_request_duration_seconds_bucket{le="0.1",method="POST",route="/api/tasks",status_code="201"} 1
taskflow_tasks_total 1
```

### 2.4 Ajouter un test — et laisser le CI le vérifier

`api/tests/metrics.test.js` :

```js
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

describe('GET /metrics', () => {
  it('expose les métriques au format Prometheus', async () => {
    const app = createApp()
    await request(app).get('/api/tasks')            // génère une requête mesurée

    const res = await request(app).get('/metrics')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toContain('http_requests_total')
    expect(res.text).toMatch(/http_requests_total\{method="GET",route="\/api\/tasks",status_code="200"\} 1/)
    expect(res.text).toContain('taskflow_tasks_total')
  })
})
```

```bash
npm run test:ci
git add . && git commit -m "feat(api): métriques Prometheus (prom-client)" && git push
gh run watch
```

**Résultat attendu :** `CI` vert (le rapport *Tests api* compte un test de plus), puis `Deploy` déploie en staging → approbation → prod. Vérifiez :

```bash
curl -s http://192.168.64.11/metrics | grep taskflow_tasks_total
```

> Le workflow réutilisable du J1 n'a **pas** été modifié : ajouter des tests à un projet n'exige aucun changement de CI. C'est ce que vous avez gagné en le factorisant.

---

## Étape 3 : `node_exporter` sur les VMs, déployé par un workflow (45 min)

### 3.1 Le rôle `node_exporter`

`ansible/roles/node_exporter/defaults/main.yml` :

```yaml
---
node_exporter_version: "1.8.2"
node_exporter_arch: "{{ 'arm64' if ansible_architecture in ['aarch64', 'arm64'] else 'amd64' }}"
node_exporter_port: 9100
node_exporter_user: node_exporter
```

`ansible/roles/node_exporter/tasks/main.yml` :

```yaml
---
- name: Créer l'utilisateur système
  ansible.builtin.user:
    name: "{{ node_exporter_user }}"
    system: true
    shell: /usr/sbin/nologin
    create_home: false

- name: Télécharger node_exporter {{ node_exporter_version }}
  ansible.builtin.get_url:
    url: "https://github.com/prometheus/node_exporter/releases/download/v{{ node_exporter_version }}/node_exporter-{{ node_exporter_version }}.linux-{{ node_exporter_arch }}.tar.gz"
    dest: "/tmp/node_exporter-{{ node_exporter_version }}.tar.gz"
    mode: "0644"

- name: Extraire l'archive
  ansible.builtin.unarchive:
    src: "/tmp/node_exporter-{{ node_exporter_version }}.tar.gz"
    dest: /tmp
    remote_src: true
    creates: "/tmp/node_exporter-{{ node_exporter_version }}.linux-{{ node_exporter_arch }}/node_exporter"

- name: Installer le binaire
  ansible.builtin.copy:
    src: "/tmp/node_exporter-{{ node_exporter_version }}.linux-{{ node_exporter_arch }}/node_exporter"
    dest: /usr/local/bin/node_exporter
    remote_src: true
    mode: "0755"
  notify: Restart node_exporter

- name: Installer l'unité systemd
  ansible.builtin.template:
    src: node_exporter.service.j2
    dest: /etc/systemd/system/node_exporter.service
    mode: "0644"
  notify: Restart node_exporter

- name: Activer et démarrer node_exporter
  ansible.builtin.systemd:
    name: node_exporter
    enabled: true
    state: started
    daemon_reload: true

- name: Ouvrir le port {{ node_exporter_port }} (UFW)
  community.general.ufw:
    rule: allow
    port: "{{ node_exporter_port }}"
    proto: tcp
```

`ansible/roles/node_exporter/handlers/main.yml` :

```yaml
---
- name: Restart node_exporter
  ansible.builtin.systemd:
    name: node_exporter
    state: restarted
    daemon_reload: true
```

`ansible/roles/node_exporter/templates/node_exporter.service.j2` :

```ini
[Unit]
Description=Prometheus Node Exporter
After=network.target

[Service]
User={{ node_exporter_user }}
ExecStart=/usr/local/bin/node_exporter --web.listen-address=:{{ node_exporter_port }}
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`ansible/playbooks/monitoring.yml` :

```yaml
---
- name: Déployer les exporters de monitoring
  hosts: web
  become: true
  roles:
    - node_exporter
  post_tasks:
    - name: Vérifier /metrics de node_exporter
      ansible.builtin.uri:
        url: "http://127.0.0.1:{{ node_exporter_port }}/metrics"
      register: ne
      retries: 3
      delay: 2
      until: ne.status == 200
```

### 3.2 Le workflow `monitoring.yml`

`.github/workflows/monitoring.yml` :

```yaml
# Déploie les exporters sur TOUTES les VMs (staging + prod) depuis le runner.
# Déclenché à la main, ou dès qu'on modifie le rôle node_exporter.
name: Monitoring (exporters)

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - 'ansible/roles/node_exporter/**'
      - 'ansible/playbooks/monitoring.yml'
      - '.github/workflows/monitoring.yml'

permissions:
  contents: read

jobs:
  exporters:
    name: 📡 node_exporter sur les VMs
    runs-on: [self-hosted, lab]
    environment: staging      # pour les secrets ; la clé SSH est la même sur les 2 VMs
    steps:
      - uses: actions/checkout@v4
      - uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}
      - run: ansible-galaxy collection install -r ansible/requirements.yml
      - name: Déployer node_exporter
        run: ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/monitoring.yml
        env:
          ANSIBLE_HOST_KEY_CHECKING: "False"
```

```bash
git add . && git commit -m "feat(monitoring): rôle node_exporter + workflow" && git push
gh run watch
curl -s http://192.168.64.11:9100/metrics | grep '^node_cpu_seconds_total' | head -2
```

**Résultat attendu :** le workflow `Monitoring (exporters)` se lance tout seul (le `push` touche les `paths`), joue le playbook sur les **deux** VMs, et `:9100/metrics` répond sur chacune.

> `group_vars/prod.yml` est chiffré : `monitoring.yml` cible aussi `prod`, il faudrait donc le mot de passe Vault… sauf qu'Ansible ne déchiffre un fichier que s'il en a besoin. Si votre run échoue avec `Attempting to decrypt`, ajoutez `--vault-password-file` comme dans `deploy.yml`.

---

## Étape 4 : Scraper l'API et les VMs, écrire les requêtes PromQL (45 min)

### 4.1 `prometheus.yml` complet

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/rules/*.yml

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']

  - job_name: node-local
    static_configs:
      - targets: ['node-exporter:9100']
        labels: { env: lab }

  # L'API TaskFlow, via nginx (port 80) qui proxy /metrics
  - job_name: taskflow-api
    metrics_path: /metrics
    static_configs:
      - targets: ['192.168.64.11:80']
        labels: { env: staging }
      - targets: ['192.168.64.12:80']
        labels: { env: prod }

  # node_exporter déployé par Ansible sur les VMs
  - job_name: node-vms
    static_configs:
      - targets: ['192.168.64.11:9100']
        labels: { env: staging }
      - targets: ['192.168.64.12:9100']
        labels: { env: prod }
```

```bash
docker compose exec prometheus promtool check config /etc/prometheus/prometheus.yml
curl -X POST http://localhost:9090/-/reload
```

**Résultat attendu :** `SUCCESS: 0 rule files found` puis, dans *Status → Targets*, **6 targets UP** (1 prometheus, 1 node-local, 2 taskflow-api, 2 node-vms).

> Les IP des VMs sont écrites en dur : c'est acceptable pour un lab. En production on utilise la **découverte de services** (`file_sd_configs`, DNS, cloud, Kubernetes).

### 4.2 Générer du trafic

```bash
for i in $(seq 1 200); do curl -s http://192.168.64.11/api/tasks >/dev/null; done
for i in $(seq 1 20);  do curl -s http://192.168.64.11/api/nope  >/dev/null; done   # des 404
curl -s -X POST http://192.168.64.11/api/tasks -H 'Content-Type: application/json' -d '{"text":"x","priority":"urgent"}'  # un 400
```

### 4.3 Les requêtes à écrire (Prometheus → Graph)

Écrivez et exécutez chacune ; notez la valeur obtenue.

| # | Indicateur | PromQL |
|---|---|---|
| 1 | Requêtes/s par environnement | `sum(rate(http_requests_total[5m])) by (env)` |
| 2 | Requêtes/s par route et code | `sum(rate(http_requests_total[5m])) by (route, status_code)` |
| 3 | Taux d'erreur 5xx (ratio) | `sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (env) / sum(rate(http_requests_total[5m])) by (env)` |
| 4 | Latence p95 | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, env))` |
| 5 | Latence moyenne | `sum(rate(http_request_duration_seconds_sum[5m])) by (env) / sum(rate(http_request_duration_seconds_count[5m])) by (env)` |
| 6 | Tâches stockées | `taskflow_tasks_total` |
| 7 | CPU utilisé (%) par VM | `100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100` |
| 8 | Mémoire utilisée (%) | `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100` |
| 9 | Disque `/` disponible (%) | `node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100` |
| 10 | Targets down | `up == 0` |

**Résultat attendu (exemples) :** la requête 1 donne ~0,6 req/s pour `staging` après la boucle ; la 3 vaut `0` (aucune 5xx) — la 404 et la 400 ne sont pas des erreurs serveur ; la 4 donne quelques millisecondes ; la 10 ne renvoie rien (« Empty query result » = tout est UP).

> **Pourquoi `rate(...[5m])` sur un compteur ?** Un compteur ne fait que croître ; sa valeur brute n'a aucun intérêt. `rate` calcule la pente par seconde sur la fenêtre. La fenêtre doit contenir au moins 2 points (ici 15 s d'intervalle → 5 m = 20 points).

Éteignez l'API staging pour voir la requête 10 réagir :

```bash
multipass exec taskflow-web1 -- sudo systemctl stop taskflow-api
# attendez 30 s, exécutez `up == 0` → taskflow-api staging = 0
multipass exec taskflow-web1 -- sudo systemctl start taskflow-api
```

---

## Étape 5 : Grafana provisionné — dashboard TaskFlow RED (45 min)

### 5.1 Le provisioning fourni

`grafana/provisioning/datasources/prometheus.yml` (fourni) :

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

`grafana/provisioning/dashboards/dashboards.yml` (fourni) :

```yaml
apiVersion: 1
providers:
  - name: taskflow
    folder: TaskFlow
    type: file
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
```

Tout fichier JSON déposé dans `grafana/provisioning/dashboards/json/` devient un dashboard au démarrage.

### 5.2 Construire le dashboard dans l'UI

**Dashboards → New → New dashboard**, puis 5 panels avec les requêtes de l'étape 4 :

| Panel | Type | Requête | Réglages |
|---|---|---|---|
| Requêtes / s | Stat | n° 1 | unit `reqps`, legend `{{env}}` |
| Taux d'erreur 5xx | Stat | n° 3 | unit `percentunit`, seuils vert < 1 %, rouge ≥ 5 % |
| Latence p95 | Time series | n° 4 | unit `s`, seuil 0.3 |
| Trafic par route | Time series | n° 2 | legend `{{route}} {{status_code}}`, stacked |
| Tâches stockées | Gauge | n° 6 | min 0, max 100 |

Ajoutez une **variable** `env` : *Settings → Variables → New* : type *Query*, requête `label_values(http_requests_total, env)`, puis remplacez dans les panels `by (env)` par un filtre `{env=~"$env"}`.

Nommez le dashboard **TaskFlow RED**, enregistrez.

### 5.3 L'exporter dans le repo

*Share → Export → Export as JSON* (laissez décoché *Export for sharing externally*) → **Save to file**, puis :

```bash
mv ~/Téléchargements/TaskFlow\ RED-*.json ~/taskflow-ops/monitoring/grafana/provisioning/dashboards/json/taskflow-red.json
```

Éditez le JSON : mettez `"uid": "taskflow-red"` et `"id": null`. Puis :

```bash
cd ~/taskflow-ops/monitoring
docker compose restart grafana
```

**Résultat attendu :** dans *Dashboards*, dossier **TaskFlow**, le dashboard *TaskFlow RED* apparaît avec un badge « provisioned ». Supprimez-le dans l'UI et redémarrez Grafana : il revient. **Le dashboard est du code.**

### 5.4 Importer « Node Exporter Full »

*Dashboards → New → Import* → ID **1860** → datasource *Prometheus* → Import. Sélectionnez `192.168.64.11:9100` dans la variable `Instance` : CPU, mémoire, disque, réseau de la VM staging.

Exportez-le lui aussi dans `json/node-exporter-full.json` (il est volumineux, c'est normal) et committez :

```bash
git add monitoring && git commit -m "feat(monitoring): stack Prometheus/Grafana + dashboards provisionnés" && git push
```

---

## Bonus

### Latence sous charge

Installez `hey` (`go install github.com/rakyll/hey@latest` ou binaire) et observez le p95 bouger :

```bash
hey -z 60s -q 50 -c 10 http://192.168.64.11/api/tasks
```

### nginx exporter

Ajoutez `nginx/nginx-prometheus-exporter` en sidecar sur les VMs (rôle `nginx_exporter`, `stub_status` sur `127.0.0.1:8080`) pour mesurer le front statique lui-même — le job `taskflow-api` ne voit que ce qui passe par Node.

---

## Livrable & critères de validation

**Livrable :** repo `taskflow-ops` avec l'API instrumentée déployée (CI + Deploy verts), le workflow `Monitoring (exporters)` exécuté, et `monitoring/` versionné (config Prometheus + dashboards JSON).

### Checklist

- [ ] `docker compose ps` : prometheus, grafana, node-exporter `running`
- [ ] `api/src/metrics.js` expose `http_requests_total`, `http_request_duration_seconds`, `taskflow_tasks_total` + métriques par défaut ; `api/tests/metrics.test.js` passe dans le CI
- [ ] `http://<ip staging>/metrics` et `http://<ip prod>/metrics` répondent via nginx
- [ ] Rôle `node_exporter` + `playbooks/monitoring.yml` + workflow `monitoring.yml` (déclenché par `paths`) ; `:9100/metrics` sur les deux VMs
- [ ] `prometheus.yml` : jobs `taskflow-api` et `node-vms` avec label `env` ; 6 targets UP
- [ ] Les 10 requêtes PromQL exécutées et comprises
- [ ] Dashboard *TaskFlow RED* provisionné depuis `json/taskflow-red.json` (uid `taskflow-red`, variable `env`) + *Node Exporter Full* importé et exporté

### Critères notés (Bloc 3 — 25 points)

| Critère | Points |
|---|---|
| Instrumentation `prom-client` : compteur, histogramme, gauge métier, middleware sans explosion de cardinalité, test unitaire | 8 |
| Rôle `node_exporter` idempotent + workflow `monitoring.yml` (déclencheur `paths`, exécution sur le runner) | 6 |
| `prometheus.yml` correct (jobs, labels `env`, `metrics_path`), targets UP, config validée par `promtool` | 4 |
| Requêtes PromQL RED/USE correctes (rate, ratio d'erreur, `histogram_quantile`, CPU/mémoire/disque) | 4 |
| Grafana provisionné en code : datasource + dashboard JSON versionné avec variable `env` | 3 |

---

## Erreurs courantes

**Target `taskflow-api` `DOWN` — `server returned HTTP status 404`**
nginx ne proxy pas `/metrics` : vérifiez le `location ~ ^/(api/|health$|metrics$)` du vhost (TP2) et redéployez.

**Target `node-vms` `DOWN` — `connection refused`**
`ufw` bloque le port 9100 (tâche UFW du rôle) ou le service n'est pas démarré (`systemctl status node_exporter` sur la VM).

**`http_requests_total` a une série par tâche (`route="/api/tasks/abc123"`)**
Le middleware utilise `req.path` même quand une route a matché : gardez `req.route?.path ?? req.path`, et déclarez le middleware **avant** les routes.

**`Error: A metric with the name http_requests_total has already been registered`**
Deux instances de l'app dans le même process (tests) : les métriques doivent être créées **une seule fois** au niveau module, pas dans `createApp()`.

**Le dashboard provisionné n'apparaît pas**
JSON invalide (`docker compose logs grafana | grep -i dashboard`), ou `"id"` non nul qui entre en conflit : mettez `"id": null`.

**`rate()` renvoie « Empty query result »**
Moins de 2 points dans la fenêtre : attendez ≥ 30 s après le premier scrape, ou élargissez à `[5m]`.

---

## Ressources

- [Prometheus — Getting started](https://prometheus.io/docs/prometheus/latest/getting_started/)
- [Prometheus — Querying basics (PromQL)](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [prom-client](https://github.com/siimon/prom-client)
- [node_exporter](https://github.com/prometheus/node_exporter)
- [Grafana — Provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)
- [Dashboard Node Exporter Full (1860)](https://grafana.com/grafana/dashboards/1860)
- [Cheatsheet Prometheus & PromQL du cours](../../ressources/cheatsheet-prometheus.md)

---

**Prochain TP** : [Jour 4 — Alerting et monitoring complet](./jour4-alerting-monitoring-complet.md)
