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
# Jour 2 — Automatiser le déploiement

**Automatisation du système CI & Monitoring**
M2 — ForEach Academy

Formateur : Fabrice Claeys

---

## Programme de la journée

| Horaire | Contenu |
|---------|---------|
| 9h00-9h45 | **Du CI au CD** — delivery vs deployment, artefact immuable, stratégies, environments, rollback |
| 9h45-10h45 | **Ansible piloté par le workflow** — job sur le runner, secrets, rôle `taskflow`, releases |
| 11h00-11h45 | **Gestion des configurations** — code / config / secrets, group_vars, Vault, smoke tests |
| 11h45-12h15 | **Ouverture** — Kubernetes, GitOps |
| 13h15-17h00 | **TP2** — Déploiement automatisé GitHub Actions + Ansible |

> Hier : le CI produit un artefact. Aujourd'hui : cet artefact traverse staging puis production **sans intervention manuelle** (sauf une approbation).

---

<!-- _class: lead -->
# 1. Du CI au CD

---

## Delivery vs Deployment

```
        CI                    Continuous DELIVERY           Continuous DEPLOYMENT
commit → build → test → artefact → deploy staging → [approbation] → deploy prod
                                                    ▲
                                       Delivery : un humain clique ici
                                       Deployment : personne ne clique
```

| | Continuous Delivery | Continuous Deployment |
|---|---|---|
| Prod | Toujours **déployable** | Toujours **déployée** |
| Déclencheur prod | Approbation humaine | Automatique si les checks passent |
| Prérequis | Pipeline fiable, staging représentatif | + monitoring et rollback automatiques |
| Adapté à | La plupart des équipes | Équipes matures, petits changements fréquents |

> Nous ferons du **Delivery** : staging automatique, production après approbation. Le Deployment n'est qu'une case à décocher de plus.

---

## Build once, deploy many

**Anti-pattern** : rebuilder pour chaque environnement.

```
staging  : git checkout → npm ci → npm run build → déployer   ← build #1
prod     : git checkout → npm ci → npm run build → déployer   ← build #2 (≠ #1 ?)
```

**Pattern** : un **artefact immuable**, identifié, promu d'environnement en environnement.

```
build → taskflow-142.tar.gz ──▶ staging (142) ──▶ approbation ──▶ prod (142)
```

- Ce qui a été testé en staging est **bit à bit** ce qui va en prod
- L'identifiant (`run_number`, SHA, version SemVer) suit l'artefact partout : `/health` l'affiche
- Formes d'artefact : archive (`upload-artifact`), image Docker taguée (`ghcr.io/…:sha-abc123`), package (npm, Maven)

---

## Artefacts entre jobs

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node-project
      - run: npm run build
      - run: tar czf taskflow-${{ github.run_number }}.tar.gz dist api --exclude=api/node_modules
      - uses: actions/upload-artifact@v4
        with: { name: taskflow-build, path: taskflow-*.tar.gz, retention-days: 30 }

  deploy-staging:
    needs: build
    runs-on: [self-hosted, lab]
    steps:
      - uses: actions/checkout@v4                   # pour ansible/ (pas pour rebuilder)
      - uses: actions/download-artifact@v4
        with: { name: taskflow-build }
      - run: tar xzf taskflow-*.tar.gz              # → dist/ et api/ dans le workspace
```

> Les artefacts sont stockés par GitHub, téléchargeables depuis n'importe quel runner — c'est le lien entre le job hosted (build) et le job self-hosted (deploy).

---

## Stratégies de déploiement

| Stratégie | Principe | Downtime | Rollback | Coût infra |
|---|---|---|---|---|
| **Recreate** | Stop v1 → start v2 | Oui | Redéployer v1 | 1× |
| **Rolling** | Remplacer les instances une par une | Non | Inverser le rolling | 1× (+1) |
| **Blue/Green** | v2 sur un 2e parc, bascule du routeur | Non | Rebasculer (instantané) | 2× |
| **Canary** | v2 sur 5 % du trafic, puis 25 %, 100 % | Non | Couper le canari | 1× (+ routeur pondéré) |
| **Symlink switch** (notre lab) | `releases/N` + lien `current` + reload | ≈ 0 | Rebasculer le lien | 1× |

```
/opt/taskflow/
├── releases/140/  141/  142/     ← N releases conservées
└── current → releases/142        ← un `ln -sfn` + `systemctl restart` = déploiement
```

> Chaque stratégie impose quelque chose au **monitoring** : un canari sans métriques par version ne sert à rien (J3/J4).

---

## GitHub Environments

*Settings → Environments* : `staging`, `production`. Un job qui déclare `environment: production` :

- attend les **required reviewers** (approbation dans l'UI, jusqu'à 6 personnes / équipes)
- respecte un **wait timer** (ex. 10 min de délai)
- n'est autorisé que depuis certaines **branches / tags** (`main`, `v*`)
- reçoit les **secrets** et **variables** de cet environment (`secrets.SSH_PRIVATE_KEY`, `vars.TARGET_IP`)
- apparaît dans l'onglet *Deployments* avec son URL et son historique

```yaml
deploy-prod:
  needs: smoke-staging
  runs-on: [self-hosted, lab]
  environment:
    name: production
    url: http://${{ vars.TARGET_IP }}      # lien cliquable dans l'UI
```

> Même variable `TARGET_IP`, valeur différente par environment : le job ne change pas, seul l'environment change.

---

## Configurer les environments pas à pas

1. *Settings → Environments → New environment* : `staging`, puis `production`
2. Sur `production` : **Required reviewers** → vous-même (ou un binôme) ; *Deployment branches* → `main` uniquement
3. Dans chaque environment : **Environment secrets** `SSH_PRIVATE_KEY`, `ANSIBLE_VAULT_PASSWORD` ; **Environment variables** `TARGET_IP`
4. Au niveau repo : variable `GRAFANA_URL`, secret `GRAFANA_TOKEN` (J4), secret `DISCORD_WEBHOOK` (bonus)

```bash
# Le même résultat en ligne de commande (gh CLI)
gh api -X PUT repos/<vous>/taskflow-ops/environments/production \
  -f 'reviewers[][type]=User' -F 'reviewers[][id]=<votre id>'
gh secret set SSH_PRIVATE_KEY --env staging < ~/.ssh/taskflow_lab
gh secret set SSH_PRIVATE_KEY --env production < ~/.ssh/taskflow_lab
gh variable set TARGET_IP --env staging --body 192.168.64.11
gh variable set TARGET_IP --env production --body 192.168.64.12
```

> Un job sans `environment:` ne voit **aucun** de ces secrets : oublier la ligne = `secrets.SSH_PRIVATE_KEY` vide.

---

## Rollback : le plan B est un job

- **Redéployer l'artefact N-1** : le plus simple et le plus sûr (l'artefact existe encore, il a déjà tourné)
- Avec des releases sur disque : rebasculer `current` → quelques secondes
- Base de données : migrations **compatibles** (expand/contract), sinon pas de rollback possible
- **Feature flags** : désactiver la fonctionnalité sans redéployer (mention : Unleash, LaunchDarkly)

```yaml
on:
  workflow_dispatch:
    inputs:
      rollback_to:
        description: Numéro de release à restaurer (vide = déploiement normal)
        default: ''
```

```bash
gh workflow run deploy.yml -f rollback_to=141
```

> Un rollback qui n'a jamais été **testé** n'existe pas. Le TP2 le teste.

---

## À retenir — Du CI au CD

- **Delivery** : prod toujours déployable, humain qui approuve ; **Deployment** : automatique
- **Build once, deploy many** : un artefact immuable identifié (`run_number`, SHA) promu de staging à prod
- Stratégies : recreate, rolling, blue/green, canary — et le **symlink switch** pour une VM
- **Environments** GitHub : approbation, secrets/variables par environnement, historique des déploiements
- Le **rollback** est un job (`workflow_dispatch` + input), testé avant d'en avoir besoin

---

<!-- _class: lead -->
# 2. Ansible piloté par le workflow

---

## Rappels express Ansible (10 min)

```
ansible/
├── ansible.cfg                  inventory, host_key_checking, callbacks
├── inventory/
│   ├── hosts.ini                [staging] web1   [prod] web2   [web:children]
│   └── group_vars/              all.yml, staging.yml, prod.yml (Vault)
├── playbooks/
│   ├── deploy.yml               hosts: web, roles: [taskflow]
│   ├── rollback.yml
│   └── monitoring.yml           (J3)
└── roles/taskflow/
    ├── defaults/main.yml        variables par défaut
    ├── tasks/main.yml           les tâches (idempotentes)
    ├── handlers/main.yml        Reload nginx, Restart taskflow-api
    └── templates/*.j2           nginx vhost, unit systemd, .env
```

- **Idempotence** : 2e exécution = `changed=0`
- `-l staging` limite aux hôtes du groupe ; `-e var=val` injecte une variable ; `--check --diff` simule

---

## Le job de déploiement, anatomie

```yaml
deploy-staging:
  needs: build
  if: inputs.rollback_to == ''
  runs-on: [self-hosted, lab]                       # a Ansible + accès aux VMs
  environment: { name: staging, url: "http://${{ vars.TARGET_IP }}" }
  env:
    ANSIBLE_HOST_KEY_CHECKING: "False"
    ANSIBLE_FORCE_COLOR: "true"
  steps:
    - uses: actions/checkout@v4
    - uses: actions/download-artifact@v4
      with: { name: taskflow-build }
    - run: tar xzf taskflow-*.tar.gz
    - uses: webfactory/ssh-agent@v0.9.0
      with: { ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }} }
    - run: echo "$VAULT_PASS" > .vault_pass && chmod 600 .vault_pass
      env: { VAULT_PASS: ${{ secrets.ANSIBLE_VAULT_PASSWORD }} }
    - run: |
        ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/deploy.yml \
          -l staging -e app_version=${{ github.run_number }} \
          --vault-password-file .vault_pass
    - run: rm -f .vault_pass
      if: always()
```

---

## Injecter la clé SSH

**Option A — `webfactory/ssh-agent`** (recommandée) : lance un agent, charge la clé, la retire à la fin du job.

```yaml
- uses: webfactory/ssh-agent@v0.9.0
  with:
    ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}
```

**Option B — fichier temporaire** (sans action tierce) :

```yaml
- run: |
    mkdir -p ~/.ssh
    echo "$KEY" > ~/.ssh/taskflow_lab
    chmod 600 ~/.ssh/taskflow_lab
  env: { KEY: ${{ secrets.SSH_PRIVATE_KEY }} }
# … et dans l'inventaire : ansible_ssh_private_key_file=~/.ssh/taskflow_lab
- run: rm -f ~/.ssh/taskflow_lab
  if: always()
```

> Sur un runner **persistant**, tout ce que vous écrivez sur disque reste : nettoyez avec `if: always()`. Un runner éphémère règle le problème à la racine.

---

## Choisir son déclencheur

| Déclencheur | Comportement | Quand l'utiliser |
|---|---|---|
| `on: push: branches: [main]` | Déploie à chaque merge sur `main` | Simple, lisible — **notre choix** |
| `on: workflow_run: workflows: [CI], types: [completed]` | Déploie **après** le workflow CI (vérifier `conclusion == 'success'`) | Séparer CI et CD en deux fichiers |
| `on: release: types: [published]` | Déploie une release taguée | Prod = versions SemVer |
| `on: workflow_dispatch: inputs:` | Manuel, avec paramètres | Rollback, redéploiement, hotfix |

```yaml
on:
  push: { branches: [main] }
  workflow_dispatch:
    inputs:
      rollback_to: { description: 'Release à restaurer', default: '' }
concurrency: { group: deploy, cancel-in-progress: false }   # jamais annuler un déploiement
```

---

## Le rôle `taskflow` étendu : ce qu'il installe

Hier (cours Ansible) : nginx qui sert `dist/`. Aujourd'hui : **front + API en service systemd**, releases versionnées.

```
VM taskflow-web1 (staging)
┌─────────────────────────────────────────────────────────┐
│ nginx :80                                               │
│   /            → /opt/taskflow/current/dist  (statique) │
│   /api, /health, /metrics → proxy_pass 127.0.0.1:3000   │
│                                                         │
│ systemd taskflow-api.service                            │
│   User=taskflow  WorkingDirectory=…/current/api         │
│   EnvironmentFile=…/current/api/.env  (PORT, APP_ENV…)  │
│   ExecStart=/usr/bin/node src/server.js   :3000         │
│                                                         │
│ /opt/taskflow/releases/{140,141,142}/  current → 142    │
└─────────────────────────────────────────────────────────┘
```

---

## Le rôle `taskflow` : tâches clés (extrait)

```yaml
- name: Créer le répertoire de la release
  ansible.builtin.file:
    path: "{{ app_root }}/releases/{{ app_version }}"
    state: directory
    owner: "{{ app_user }}"

- name: Copier le front et l'API
  ansible.builtin.copy:
    src: "{{ playbook_dir }}/../../{{ item }}/"      # dist/ et api/ extraits de l'artefact
    dest: "{{ app_root }}/releases/{{ app_version }}/{{ item }}/"
  loop: [dist, api]

- name: Installer les dépendances de production de l'API
  ansible.builtin.command: npm ci --omit=dev
  args:
    chdir: "{{ app_root }}/releases/{{ app_version }}/api"
    creates: "{{ app_root }}/releases/{{ app_version }}/api/node_modules"

- name: Basculer le lien current
  ansible.builtin.file:
    src: "{{ app_root }}/releases/{{ app_version }}"
    dest: "{{ app_root }}/current"
    state: link
  notify: [Restart taskflow-api, Reload nginx]
```

---

## Unit systemd et vhost nginx (templates Jinja2)

```ini
# templates/taskflow-api.service.j2
[Unit]
Description=TaskFlow API ({{ app_env }})
After=network.target
[Service]
User={{ app_user }}
WorkingDirectory={{ app_root }}/current/api
EnvironmentFile={{ app_root }}/current/api/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
[Install]
WantedBy=multi-user.target
```

```nginx
# templates/nginx-taskflow.conf.j2
server {
  listen 80; server_name {{ app_server_name }};
  root {{ app_root }}/current/dist;
  location / { try_files $uri $uri/ /index.html; }
  location ~ ^/(api|health|metrics) { proxy_pass http://127.0.0.1:{{ api_port }}; }
}
```

---

## Zero-downtime « simple » et conservation des releases

```yaml
- name: Lister les releases (plus récentes en dernier)
  ansible.builtin.find:
    paths: "{{ app_root }}/releases"
    file_type: directory
  register: releases

- name: Supprimer les releases au-delà de keep_releases
  ansible.builtin.file:
    path: "{{ item.path }}"
    state: absent
  loop: "{{ (releases.files | sort(attribute='mtime'))[:-keep_releases] }}"
```

- Le déploiement prépare **tout** dans `releases/N` (copie, `npm ci`, `.env`) pendant que `current` sert encore N-1
- La bascule = `ln -sfn` + `systemctl restart` : quelques centaines de ms d'indisponibilité de l'API, nginx continue de servir le front
- `keep_releases: 5` → rollback possible sur 5 versions, disque borné

---

## Le workflow Deploy complet (vue d'ensemble)

```
deploy.yml
on: push main | workflow_dispatch(rollback_to)
concurrency: deploy (cancel-in-progress: false)

  build (ubuntu-latest)         if: rollback_to == ''
    └─▶ artefact taskflow-build
  deploy-staging [self-hosted, lab]  environment: staging
    └─▶ smoke-staging   curl -fsS http://$TARGET_IP/health
          └─▶ deploy-prod [self-hosted, lab]  environment: production  ⏸ approbation
                └─▶ smoke-prod

  rollback [self-hosted, lab]   if: rollback_to != ''   environment: production
    └─▶ ansible-playbook rollback.yml -e rollback_to=$INPUT
```

---

## Le workflow Deploy : smoke test et prod

```yaml
smoke-staging:
  needs: deploy-staging
  runs-on: [self-hosted, lab]
  environment: staging
  steps:
    - run: |
        for i in $(seq 1 10); do
          curl -fsS "http://${{ vars.TARGET_IP }}/health" && exit 0
          sleep 3
        done
        echo "::error::L'API staging ne répond pas"; exit 1

deploy-prod:
  needs: smoke-staging
  runs-on: [self-hosted, lab]
  environment: { name: production, url: "http://${{ vars.TARGET_IP }}" }   # ⏸ reviewers
  steps:
    # … identique à deploy-staging avec -l prod
    - run: ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/deploy.yml \
             -l prod -e app_version=${{ github.run_number }} --vault-password-file .vault_pass
```

> Le smoke test tourne sur le runner (il voit les VMs). Il vérifie aussi que `version` dans `/health` = `run_number`.

---

## Le workflow Deploy : rollback

```yaml
rollback:
  if: inputs.rollback_to != ''
  runs-on: [self-hosted, lab]
  environment: production                    # approbation aussi pour un rollback
  steps:
    - uses: actions/checkout@v4
    - uses: webfactory/ssh-agent@v0.9.0
      with: { ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }} }
    - run: |
        ansible-playbook -i ansible/inventory/hosts.ini ansible/playbooks/rollback.yml \
          -l prod -e rollback_to=${{ inputs.rollback_to }}
    - run: curl -fsS "http://${{ vars.TARGET_IP }}/health" | grep -q '"version":"${{ inputs.rollback_to }}"'
```

`rollback.yml` : vérifie que `releases/<rollback_to>` existe, rebascule `current`, redémarre l'API, recharge nginx.

> `inputs.rollback_to` est vide lors d'un `push` : les deux chemins sont exclusifs grâce aux `if:`.

---

## `rollback.yml` (extrait)

```yaml
- name: Revenir à une release précédente
  hosts: web
  become: true
  pre_tasks:
    - ansible.builtin.assert:
        that: rollback_to is defined
        fail_msg: "Passez -e rollback_to=<numéro de release>"
    - ansible.builtin.stat:
        path: "{{ app_root }}/releases/{{ rollback_to }}"
      register: rel
    - ansible.builtin.fail:
        msg: "La release {{ rollback_to }} n'existe plus sur {{ inventory_hostname }}"
      when: not rel.stat.exists
  tasks:
    - name: Rebasculer current
      ansible.builtin.file:
        src: "{{ app_root }}/releases/{{ rollback_to }}"
        dest: "{{ app_root }}/current"
        state: link
      notify: [Restart taskflow-api, Reload nginx]
```

> Rien n'est recopié : la release est déjà sur le disque. C'est pour cela que `keep_releases` existe.

---

## Notifier la fin d'un déploiement (bonus)

```yaml
notify:
  needs: [smoke-prod]
  if: always()
  runs-on: ubuntu-latest
  steps:
    - run: |
        STATUS="${{ needs.smoke-prod.result }}"
        curl -sS -H 'Content-Type: application/json' "$WEBHOOK" -d @- <<JSON
        {"content": "🚀 TaskFlow v${{ github.run_number }} — prod : **$STATUS**\n${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"}
        JSON
      env: { WEBHOOK: ${{ secrets.DISCORD_WEBHOOK }} }
```

- `if: always()` : on veut aussi être prévenu d'un **échec**
- Slack : même principe (`{"text": …}`) ; Teams : carte adaptative
- Le lien vers le run est la première chose qu'on cherche à 18 h un vendredi

---

## Démo live

1. Push sur `main` → `build` (hosted) → `deploy-staging` (notre runner) → `smoke-staging` vert
2. `deploy-prod` en attente : onglet *Deployments*, bouton **Review deployments** → approuver
3. `curl http://web2/health` → `"version":"142"`
4. `gh workflow run deploy.yml -f rollback_to=141` → approbation → `"version":"141"`

---

## À retenir — Ansible piloté par le workflow

- Le job de déploiement tourne sur le **runner self-hosted** (Ansible + réseau du lab) et consomme l'**artefact** du build
- Clé SSH et mot de passe Vault viennent des **secrets d'environment** ; nettoyage `if: always()`
- Déclencheur : `push main` + `workflow_dispatch` (rollback) ; `concurrency` sans annulation
- Rôle `taskflow` : `releases/N` + `current` + systemd + nginx proxy → bascule quasi instantanée, rollback trivial
- **Smoke test** après chaque déploiement, **approbation** avant la prod

---

<!-- _class: lead -->
# 3. Gestion des configurations pour le déploiement

---

## Code, configuration, secrets (12-factor)

| | Où | Exemple TaskFlow | Change… |
|---|---|---|---|
| **Code** | Git, l'artefact | `api/src/*.js`, `dist/` | à chaque version |
| **Configuration** | Par environnement, hors artefact | `APP_ENV`, `PORT`, `server_name`, IP | par environnement |
| **Secrets** | Chiffrés / coffre, jamais en clair dans Git | mot de passe DB, token API | rarement, rotation |

Règle 12-factor : la config est **injectée** (variables d'environnement), l'artefact est **identique** partout.

```
# /opt/taskflow/current/api/.env  (généré par Ansible depuis api.env.j2)
PORT=3000
APP_ENV=staging
APP_VERSION=142
```

---

## Configuration par environnement : deux niveaux

**Niveau GitHub** (ce que le workflow doit savoir) :

| Environment | `vars.TARGET_IP` | `secrets.SSH_PRIVATE_KEY` | `secrets.ANSIBLE_VAULT_PASSWORD` |
|---|---|---|---|
| staging | 192.168.64.11 | clé du lab | mot de passe Vault |
| production | 192.168.64.12 | clé du lab | mot de passe Vault |

**Niveau Ansible** (ce que le rôle doit savoir) :

```yaml
# group_vars/all.yml            # group_vars/staging.yml      # group_vars/prod.yml (Vault)
app_root: /opt/taskflow         app_env: staging             app_env: prod
app_user: taskflow              app_server_name: staging.tf  app_server_name: taskflow.example
api_port: 3000                                               api_secret: !vault |
keep_releases: 5                                               $ANSIBLE_VAULT;1.1;AES256…
```

> Le même playbook, limité par `-l staging` ou `-l prod`, charge automatiquement le bon `group_vars`.

---

## Secrets : Ansible Vault + secret GitHub

```bash
# Chiffrer le fichier de variables de prod (une fois, sur votre poste)
ansible-vault encrypt ansible/inventory/group_vars/prod.yml
# Éditer / relire
ansible-vault edit ansible/inventory/group_vars/prod.yml
ansible-vault view ansible/inventory/group_vars/prod.yml
```

- Le fichier chiffré est **committé** (c'est le but) ; le mot de passe est un **secret d'environment** GitHub
- Le workflow écrit le mot de passe dans un fichier `600`, passe `--vault-password-file`, supprime le fichier
- Rotation : `ansible-vault rekey` + mettre à jour le secret GitHub

```yaml
- run: echo "$VAULT_PASS" > .vault_pass && chmod 600 .vault_pass
  env: { VAULT_PASS: ${{ secrets.ANSIBLE_VAULT_PASSWORD }} }
```

> Alternative en entreprise : HashiCorp Vault / SOPS + clé KMS, avec **OIDC** pour que le job s'authentifie sans secret stocké.

---

## Ne jamais fuiter un secret dans les logs

- GitHub masque les `secrets.*` (`***`) — mais **pas** une valeur dérivée : `echo ${SECRET:0:4}`, base64, JSON
- `::add-mask::` pour masquer une valeur produite pendant le job
- `set -x` dans un script bash affiche les commandes **avec** leurs arguments → jamais avec un secret
- Ansible : `no_log: true` sur les tâches qui manipulent des secrets ; sinon `-v` les affiche

```yaml
- name: Écrire le .env de l'API
  ansible.builtin.template:
    src: api.env.j2
    dest: "{{ app_root }}/releases/{{ app_version }}/api/.env"
    mode: "0640"
  no_log: true
```

```yaml
- run: |
    TOKEN=$(curl -s … | jq -r .token)
    echo "::add-mask::$TOKEN"
    echo "token=$TOKEN" >> "$GITHUB_OUTPUT"
```

---

## Templates Jinja2 : la config est générée, jamais éditée à la main

```jinja
{# templates/api.env.j2 #}
PORT={{ api_port }}
APP_ENV={{ app_env }}
APP_VERSION={{ app_version }}
{% if api_secret is defined %}
API_SECRET={{ api_secret }}
{% endif %}
```

- Un fichier généré porte une **empreinte** : `{{ ansible_managed }}` en en-tête
- Modifier à la main sur le serveur = perdu au prochain déploiement (et c'est voulu)
- Le **diff** est visible avant d'appliquer : `ansible-playbook … --check --diff`

---

## Où vivent les fichiers d'infra ?

| Organisation | Avantages | Inconvénients |
|---|---|---|
| **Mono-repo** app + `ansible/` (notre choix) | Un commit = code + config cohérents ; un seul pipeline | Droits identiques pour devs et ops ; repo plus gros |
| **Repo infra séparé** | Séparation des responsabilités, réutilisable pour N apps | Synchroniser deux repos (quelle version de rôle pour quelle version d'app ?) |
| **Rôles publiés** (Galaxy / collection interne) + `requirements.yml` | Versionnés, testés (Molecule), partagés | Overhead de publication |

> Pour une équipe produit qui possède son déploiement : mono-repo. Pour une équipe plateforme qui sert 20 équipes : repo infra + rôles versionnés.

---

## Vérifier après avoir déployé

| Niveau | Quoi | Où |
|---|---|---|
| **Playbook** | `uri` sur `http://127.0.0.1:3000/health` avec `retries` | `post_tasks` du playbook (depuis la VM) |
| **Smoke test** | `curl -fsS http://$TARGET_IP/health` + contrôle de la version | Job `smoke-*` (depuis le runner) |
| **E2E minimal** | 1 scénario Playwright « créer une tâche » contre staging | Job optionnel après smoke |
| **Pré-prod** | `ansible-playbook … --check --diff -l prod` | Avant approbation, pour voir ce qui va changer |
| **Monitoring** | Taux d'erreur / latence après déploiement | J3-J4 : c'est le vrai test |

```yaml
post_tasks:
  - ansible.builtin.uri: { url: "http://127.0.0.1:{{ api_port }}/health", return_content: true }
    register: health
    retries: 5
    delay: 2
    until: health.status == 200
```

---

## Checklist d'un déploiement automatisé

- [ ] L'artefact est construit **une fois** et identifié (`run_number` / SHA visible dans `/health`)
- [ ] Le job de déploiement ne rebuild rien ; il télécharge l'artefact
- [ ] Secrets en **environment secrets**, jamais dans le YAML, jamais dans les logs (`no_log`, `add-mask`)
- [ ] `concurrency` sans annulation sur le déploiement
- [ ] Staging automatique, **prod approuvée**
- [ ] Smoke test après chaque environnement (avec contrôle de version)
- [ ] Rollback = un job, **testé**
- [ ] Config générée par templates, `--check --diff` disponible
- [ ] Nettoyage du runner (`if: always()`) ou runner éphémère
- [ ] Notification (succès **et** échec) avec lien vers le run

---

## À retenir — Gestion des configurations

- **Code / config / secrets** séparés : l'artefact est identique, la config est injectée (`.env`, `group_vars`)
- Deux niveaux : **environment GitHub** (`vars`, `secrets`) et **group_vars Ansible** (`-l staging|prod`)
- Secrets : **Vault** committé + mot de passe en secret d'environment ; `no_log`, `::add-mask::`, jamais `set -x`
- Config **générée** par templates (`ansible_managed`), visible avec `--check --diff`
- Vérifier : `post_tasks` + smoke test + (E2E) + monitoring

---

<!-- _class: lead -->
# 4. Ouverture : Kubernetes et GitOps

---

## Le même workflow, cible Kubernetes

Ce qui change : l'artefact devient une **image** et le déploiement une mise à jour de manifest.

```yaml
build:
  steps:
    - uses: docker/build-push-action@v6
      with: { push: true, tags: ghcr.io/${{ github.repository }}:${{ github.sha }} }

deploy-staging:
  runs-on: [self-hosted, lab]            # a kubectl + kubeconfig du cluster k3d
  environment: staging
  steps:
    - run: kubectl -n taskflow set image deployment/taskflow \
             taskflow=ghcr.io/${{ github.repository }}:${{ github.sha }}
    - run: kubectl -n taskflow rollout status deployment/taskflow --timeout=120s
```

Ou avec Ansible (cours précédent) : `kubernetes.core.k8s` + template du Deployment. Ou Helm : `helm upgrade --install … --set image.tag=${{ github.sha }}`.

- Rolling update et rollback (`kubectl rollout undo`) sont **natifs**
- Le smoke test devient une `readinessProbe`

---

## GitOps : inverser le sens du déploiement

```
   PUSH (ce que nous faisons)               PULL / GitOps
   pipeline ──kubectl apply──▶ cluster      pipeline ──commit──▶ repo "état désiré"
                                                                        ▲
                                            cluster ◀──Argo CD / Flux──┘ (réconciliation continue)
```

- Le pipeline **ne touche plus au cluster** : il construit l'image et **modifie un manifest** (tag) dans un repo Git
- Un agent dans le cluster (Argo CD, Flux) compare Git ↔ cluster en permanence et applique les écarts
- Avantages : Git = source de vérité auditable, rollback = `git revert`, pas de credentials cluster dans le CI, dérive détectée
- Coût : un composant de plus à opérer ; courbe d'apprentissage

---

## Où mettre le curseur ?

| Contexte | Réponse raisonnable |
|---|---|
| 1 à 3 services, une PME, une VM ou deux | **VM + Ansible depuis le pipeline** (ce que nous faisons) |
| Plusieurs équipes, dizaines de services, scaling | Kubernetes + pipeline qui pousse l'image + `kubectl`/Helm |
| Exigences d'audit, multi-clusters, plateforme interne | Kubernetes + **GitOps** (Argo CD / Flux) |

> Le bon outil est celui que l'équipe sait **opérer** à 3 h du matin. Une VM bien déployée par Ansible vaut mieux qu'un cluster que personne ne comprend.

---

## À retenir — Ouverture

- Sur Kubernetes, l'artefact est une **image**, le déploiement une mise à jour de manifest ; rolling/rollback natifs
- **GitOps** = le cluster tire l'état désiré depuis Git ; le pipeline ne fait que construire et committer
- Le curseur dépend de la **taille** et de la **maturité** de l'équipe, pas de la mode

---

<!-- _class: lead -->
# TP de l'après-midi

---

## TP2 — Déploiement automatisé GitHub Actions + Ansible (3h45)

| Étape | Contenu | Durée |
|---|---|---|
| 1 | VMs `taskflow-web1` / `taskflow-web2` (`lab-up.sh`) ; environments `staging` / `production` (reviewer requis) ; secrets `SSH_PRIVATE_KEY`, `ANSIBLE_VAULT_PASSWORD`, variable `TARGET_IP` ; `ansible all -m ping` depuis le runner | 30 min |
| 2 | Rôle `taskflow` : `releases/<run_number>`, lien `current`, unit systemd `taskflow-api`, vhost nginx proxy `/api` | 1h |
| 3 | `deploy.yml` : `build` (artefact) → `deploy-staging` (runner + Ansible) → `smoke-staging` | 45 min |
| 4 | `deploy-prod` (approbation) + `smoke-prod` ; `group_vars/prod.yml` chiffré Vault ; masquage vérifié | 45 min |
| 5 | Rollback : `workflow_dispatch` input `rollback_to` → job `rollback` (`rollback.yml`) ; test réel | 30 min |
| Bonus | Notification Discord/Slack avec version + lien du run | |

**Livrable** : workflow complet build → staging → approbation → prod ; TaskFlow (front + API) sur les deux VMs ; rollback démontré.

Énoncé : `tp/fil-rouge-taskflow/jour2-deploiement-ansible.md`

---

## Synthèse de la journée

- Un artefact **immuable** traverse les environnements ; on ne rebuild jamais pour la prod
- Le déploiement est un **job** sur le runner self-hosted : Ansible, secrets d'environment, smoke test
- **Environments** GitHub = approbation, variables et secrets par environnement, historique
- Config générée, secrets chiffrés, **rollback** testé
- Kubernetes et GitOps : même logique, autres outils

**Demain** : on regarde ce que fait l'application une fois déployée — métriques, Prometheus, Grafana.

---

<!-- _class: lead -->
# Questions ?

**Ressources**
- docs.github.com/actions — *Managing environments for deployment*, *Storing workflow data as artifacts*
- docs.ansible.com — *Vault*, module `file` (state: link), `template`
- `ressources/cheatsheet-github-actions.md`
