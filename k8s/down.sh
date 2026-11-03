#!/usr/bin/env bash
# Deletes the kind cluster and everything in it, volumes included.
#   bash k8s/down.sh
set -euo pipefail
kind delete cluster --name wiki
