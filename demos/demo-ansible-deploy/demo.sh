#!/usr/bin/env bash
# Démo J2 : 3 déploiements puis un rollback, en local
set -e; cd "$(dirname "$0")"
for v in 1 2 3 4; do ansible-playbook playbook.yml -e version=$v | grep -E "msg|changed"; done
ls -la /tmp/demo-app/ /tmp/demo-app/releases/
echo "--- rollback vers la 3 (le lien change, rien n'est retransféré)"
ansible-playbook playbook.yml -e version=3 | grep msg
readlink /tmp/demo-app/current
