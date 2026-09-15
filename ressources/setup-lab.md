# Guide d'installation du lab — Automatisation CI & Monitoring (M2 DevOps)

> ForEach Academy — Formateur : Fabrice Claeys

---

## 1. Vue d'ensemble de l'architecture du lab

```
                    ┌──────────────────────────────────────────────┐
                    │                 GITHUB (cloud)               │
                    │  repo taskflow-ops                           │
                    │   ├─ workflows CI (runners GitHub-hosted)    │
                    │   ├─ environments staging / production       │
                    │   │    (secrets, variables, approbation)     │
                    │   └─ jobs `runs-on: [self-hosted, lab]` ─────┼──────┐
                    └──────────────────────────────────────────────┘      │ long-polling HTTPS
                                                                          │ (le runner APPELLE GitHub,
┌─────────────────────────────────────────────────────────────────────────┼─── aucun port entrant)
│                          POSTE ÉTUDIANT                                 ▼
│  ┌───────────────────────────────────────────┐   ┌────────────────────────────────┐
│  │  Docker (Desktop / Engine)                │   │  Multipass (ou Incus)          │
│  │                                           │   │                                │
│  │  ┌─────────────────────────────────────┐  │   │  ┌──────────────────────────┐  │
│  │  │ taskflow-runner  (self-hosted)      │  │   │  │ taskflow-web1 = STAGING  │  │
│  │  │  ansible · rsync · node · docker    ├──┼───┼─►│  nginx :80 → API :3000   │  │
│  │  └─────────────────────────────────────┘  │SSH│  │  node_exporter :9100     │  │
│  │                                           │   │  └──────────────────────────┘  │
│  │  ┌─────────────────────────────────────┐  │   │  ┌──────────────────────────┐  │
│  │  │ stack monitoring (compose)          │  │   │  │ taskflow-web2 = PROD     │  │
│  │  │  prometheus :9090  grafana :3001    │◄─┼───┼──┤  nginx :80 → API :3000   │  │
│  │  │  alertmanager :9093 mailhog :8025   │scrape │  node_exporter :9100     │  │
│  │  │  node-exporter cadvisor blackbox    │  │   │  └──────────────────────────┘  │
│  │  └─────────────────────────────────────┘  │   │                                │
│  └───────────────────────────────────────────┘   └────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────────────────────
```

Trois briques sur le poste, toutes déjà vues dans les cours précédents :

| Brique | Rôle | Cours d'origine |
|---|---|---|
| Docker + Compose v2 | runner self-hosted + stack de monitoring | Virtualisation Docker |
| Multipass (ou Incus) | 2 VMs Ubuntu = serveurs staging et prod | Ansible & Kubernetes |
| Compte GitHub | repo `taskflow-ops`, workflows, environments | Initialisation CI |

---

## 2. Prérequis par système

### Windows 10/11

1. **WSL2 + Ubuntu** (déjà en place depuis le cours Ansible) : `wsl --install -d Ubuntu`
2. **Docker Desktop** avec l'intégration WSL2 activée (*Settings → Resources → WSL integration*)
3. **Multipass** : https://multipass.run (backend Hyper-V) — vérifier `multipass version`
4. Tout le reste se fait **dans le terminal WSL2** (git, ansible en local pour tester, scripts du lab)

### macOS

1. **Docker Desktop** (ou OrbStack) : `docker compose version`
2. **Multipass** : `brew install --cask multipass`
3. `brew install ansible git` (Ansible en local sert à tester les playbooks hors workflow)

### Linux

1. **Docker Engine** + plugin compose : `docker compose version` ; votre utilisateur dans le groupe `docker`
2. **Multipass** : `sudo snap install multipass` — ou **Incus** (`lab-up.sh` bascule automatiquement)
3. `sudo apt install ansible git` (ou `pipx install --include-deps ansible`)

> Sous Linux, si les VMs ne sont pas joignables depuis le conteneur du runner,
> passez le runner en `network_mode: host` (voir §5).

---

## 3. Les VMs du lab (staging / prod)

```bash
cd ressources/lab
./lab-up.sh                 # crée taskflow-web1 et taskflow-web2, injecte ~/.ssh/taskflow_lab.pub
```

Le script affiche les IP, écrit `inventory.generated.ini` (à recopier dans
`ansible/inventory/hosts.ini`) et rappelle les variables GitHub à créer.

```bash
ssh -i ~/.ssh/taskflow_lab ubuntu@<ip_web1> hostname      # doit répondre taskflow-web1
./lab-down.sh               # pour tout supprimer en fin de formation
```

> Les VMs du cours Ansible peuvent être réutilisées telles quelles : `lab-up.sh`
> détecte qu'elles existent et se contente de ré-injecter la clé.

---

## 4. Le runner self-hosted

```bash
cd ressources/lab/runner
cp .env.example .env
```

1. Sur GitHub : votre repo → **Settings → Actions → Runners → New self-hosted runner**
2. Copiez le token affiché après `--token` dans `.env` (`RUNNER_TOKEN=…`, valable 1 h)
3. `REPO_URL=https://github.com/<vous>/taskflow-ops`

```bash
docker compose up -d --build          # ≈ 3 min la première fois
docker compose logs -f runner         # attendre : Listening for Jobs
```

Vérifiez dans *Settings → Actions → Runners* : `lab-runner` **Idle**, labels
`self-hosted · linux · x64 · lab · ansible`. Détails et dépannage : [lab/runner/README.md](lab/runner/README.md).

---

## 5. Réseau : le runner doit joindre les VMs

```bash
docker compose exec runner ping -c 1 <ip_web1>
```

| Résultat | Action |
|---|---|
| Réponse au ping | rien à faire |
| Pas de réponse sous **Linux** | dans `docker-compose.yml` : décommenter `network_mode: host`, supprimer `ports`/`extra_hosts`, `docker compose up -d` |
| Pas de réponse sous macOS/Windows | vérifier que le poste joint la VM (`ping` depuis le terminal) ; redémarrer Docker Desktop ; en dernier recours [lab/ssh-target](lab/ssh-target/README.md) |

Le runner joint aussi Grafana sur le poste via `http://host.docker.internal:3001`
(variable GitHub `GRAFANA_URL`).

---

## 6. Configuration GitHub du repo `taskflow-ops`

### Environments (Settings → Environments)

| Environment | Variables | Secrets | Protection |
|---|---|---|---|
| `staging` | `TARGET_IP` = IP de web1 | `SSH_PRIVATE_KEY`, `ANSIBLE_VAULT_PASSWORD` | aucune |
| `production` | `TARGET_IP` = IP de web2 | `SSH_PRIVATE_KEY`, `ANSIBLE_VAULT_PASSWORD` | **Required reviewers** : vous-même |

### Niveau repo (Settings → Secrets and variables → Actions)

| Type | Nom | Valeur |
|---|---|---|
| variable | `GRAFANA_URL` | `http://host.docker.internal:3001` |
| secret | `GRAFANA_TOKEN` | service account token Grafana (J4 : *Administration → Service accounts*) |
| secret | `DISCORD_WEBHOOK` | webhook d'un salon Discord (bonus) |

`SSH_PRIVATE_KEY` = **contenu complet** de `~/.ssh/taskflow_lab` (avec les lignes BEGIN/END).
`ANSIBLE_VAULT_PASSWORD` = le mot de passe choisi pour `ansible-vault encrypt`.

---

## 7. Ports utilisés sur le poste

| Port | Service | Où |
|---|---|---|
| 3000 | API TaskFlow en local (`npm start`) | poste |
| 3001 | Grafana | stack monitoring |
| 9090 | Prometheus | stack monitoring |
| 9093 | Alertmanager | stack monitoring |
| 9100 | node-exporter (poste) | stack monitoring |
| 9115 | blackbox-exporter | stack monitoring |
| 8081 | cAdvisor | stack monitoring |
| 8025 / 1025 | MailHog UI / SMTP | stack monitoring |
| 80 / 3000 / 9100 | nginx / API / node_exporter | **sur chaque VM** |

---

## 8. Vérification finale (avant le Jour 1)

```bash
docker compose version                          # v2.x
multipass list                                  # 2 VMs Running (ou incus list)
ssh -i ~/.ssh/taskflow_lab ubuntu@<ip_web1> true && echo "SSH OK"
cd ressources/lab/runner && docker compose ps   # runner Up
# GitHub → Actions → "Hello runner" → Run workflow → job vert sur lab-runner
```

---

## 9. Dépannage

| Symptôme | Cause probable | Correctif |
|---|---|---|
| Job bloqué *Waiting for a runner* | labels différents / runner offline | `docker compose ps`, comparer `runs-on` et labels |
| `Permission denied (publickey)` dans le job | `SSH_PRIVATE_KEY` incomplet ou mauvaise clé | recoller le contenu complet de `~/.ssh/taskflow_lab` |
| `UNREACHABLE` Ansible | IP changée après reboot des VMs | `multipass list` → mettre à jour `hosts.ini` et `TARGET_IP` |
| `Decryption failed` | `ANSIBLE_VAULT_PASSWORD` ≠ mot de passe du fichier | re-chiffrer ou corriger le secret |
| Prometheus : target `DOWN` sur `<ip>:9100` | node_exporter non déployé / UFW | lancer le workflow *Monitoring agents* ; `sudo ufw status` |
| Grafana : annotation refusée (401) | token invalide ou rôle Viewer | service account avec rôle **Editor** |
| Runner : *token expired* | token d'enregistrement > 1 h | régénérer le token, `docker compose up -d` |
