#!/usr/bin/env bash
# Empties the kind cluster's data and redeploys on top of it: Kafka (every topic,
# message and consumer offset) and the SeaweedFS archive. Keeps the cluster itself,
# Strimzi, KEDA and the images already loaded into the nodes, so it's much quicker
# than down.sh + up.sh. Run from anywhere:
#   bash k8s/clean.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# Git Bash on Windows rewrites arguments that look like /unix/paths before
# passing them to native programs (kubectl); this turns that off
export MSYS_NO_PATHCONV=1

CLUSTER=wiki
# Every call names the context, so it never touches whatever cluster is current
k() { kubectl --context "kind-$CLUSTER" -n wiki "$@"; }

step() { printf '\n==> %s\n' "$*"; }

if ! kind get clusters | grep -qx "$CLUSTER"; then
  echo "kind cluster '$CLUSTER' doesn't exist, nothing to clean (bash k8s/up.sh creates it)" >&2
  exit 1
fi

step "Apps (they'd otherwise crash-loop against a missing Kafka)"
k delete -k k8s/apps --ignore-not-found --wait --timeout=3m

step "Topics, while the Topic Operator still runs to remove their finalizers"
k delete kafkatopic --all --wait --timeout=3m

step "Kafka and SeaweedFS"
k delete kafka/wiki kafkanodepool/dual-role deploy/seaweedfs --ignore-not-found --wait --timeout=3m
# The pods hold the volumes; a PVC isn't deleted until nothing mounts it
k wait pod -l strimzi.io/cluster=wiki --for=delete --timeout=3m
k wait pod -l app=seaweedfs --for=delete --timeout=3m

step "Volumes"
# The pool keeps its PVCs on purpose (deleteClaim: false in kafka.yaml), so they go by hand.
# Reclaim policy Delete: local-path then removes the directories on the nodes.
pvcs=$(k get pvc -l strimzi.io/cluster=wiki -o name; k get pvc seaweedfs-data -o name --ignore-not-found)
if [ -n "$pvcs" ]; then
  pvs=$(for pvc in $pvcs; do printf 'pv/%s ' "$(k get "$pvc" -o jsonpath='{.spec.volumeName}')"; done)
  k delete $pvcs --wait --timeout=3m
  # The PV disappears once local-path's helper pod has deleted the data
  kubectl --context "kind-$CLUSTER" wait --for=delete $pvs --timeout=3m
fi

step "Kafka, topics, Kafbat UI, SeaweedFS (fresh)"
k apply -k k8s/infra
k wait kafka/wiki --for=condition=Ready --timeout=10m
k wait kafkatopic --all --for=condition=Ready --timeout=3m
k rollout status deploy/seaweedfs --timeout=5m
k rollout status deploy/kafbat-ui --timeout=5m

step "Apps"
k apply -k k8s/apps
for app in ingester archiver bursts api web; do
  k rollout status "deploy/$app" --timeout=5m
done

step "Done"
k get pods -o wide
