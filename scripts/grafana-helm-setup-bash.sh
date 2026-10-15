helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

helm upgrade --install mon prometheus-community/kube-prometheus-stack --version 92.3.0 \
    --namespace monitoring --create-namespace \
    -f ../platform/monitoring-values.yaml

kubectl -n monitoring get pods -w
