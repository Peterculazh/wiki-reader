#!/usr/bin/env bash
# Creates the kind cluster and deploys everything on it: the same steps as the
# README's "Kubernetes" section, in the same order. Run from anywhere:
#   bash k8s/up.sh
# Safe to re-run: an existing cluster is reused and every step is an upsert.
set -euo pipefail
cd "$(dirname "$0")/.."
# Git Bash on Windows rewrites arguments that look like /unix/paths before
# passing them to native programs (docker, kubectl); this turns that off
export MSYS_NO_PATHCONV=1

CLUSTER=wiki
STRIMZI_VERSION=1.3.0
KEDA_VERSION=2.21.0
IMAGE=wiki-reader:dev

step() { printf '\n==> %s\n' "$*"; }

step "kind cluster '$CLUSTER'"
if kind get clusters | grep -qx "$CLUSTER"; then
  echo "exists, reusing it"
else
  kind create cluster --config k8s/kind-config.yaml
fi
# kind create switches the context; a reused cluster might not be the current one
kubectl config use-context "kind-$CLUSTER"

step "Namespace (before Strimzi, which needs it to exist)"
kubectl apply -f k8s/namespace.yaml

step "Strimzi $STRIMZI_VERSION"
helm upgrade --install strimzi oci://quay.io/strimzi-helm/strimzi-kafka-operator \
  --version "$STRIMZI_VERSION" \
  --namespace strimzi --create-namespace \
  --set 'watchNamespaces={wiki}' \
  --wait

step "KEDA $KEDA_VERSION"
helm repo add kedacore https://kedacore.github.io/charts --force-update
helm upgrade --install keda kedacore/keda \
  --version "$KEDA_VERSION" \
  --namespace keda --create-namespace \
  --wait

step "Kafka, topics, Kafbat UI, SeaweedFS"
kubectl apply -k k8s/infra
kubectl -n wiki wait kafka/wiki --for=condition=Ready --timeout=10m
kubectl -n wiki wait kafkatopic --all --for=condition=Ready --timeout=3m
kubectl -n wiki rollout status deploy/seaweedfs --timeout=5m
kubectl -n wiki rollout status deploy/kafbat-ui --timeout=5m

step "App image $IMAGE"
docker build -t "$IMAGE" .
# Smoke test: the native librdkafka binary is in the image and loads
docker run --rm "$IMAGE" node --input-type=module \
  -e "import k from '@confluentinc/kafka-javascript'; console.log('librdkafka', k.librdkafkaVersion)"
# Copies the image into every kind node; there is no registry
kind load docker-image "$IMAGE" --name "$CLUSTER"

step "Apps"
kubectl apply -k k8s/apps
for app in ingester archiver bursts; do
  kubectl -n wiki rollout status "deploy/$app" --timeout=5m
done

step "Done"
kubectl -n wiki get pods -o wide
