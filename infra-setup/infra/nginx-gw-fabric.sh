# step 1.

kubectl kustomize "https://github.com/nginx/nginx-gateway--fabric/config/crd/gateway-api/standard?ref=v2.7.2 |
kubectl apply -f -

# step 2.
helm install ngf oci://ghcr.io/nginx/charts/nginx-gateway-fabric --version 2.7.2 \
--create-namespace --namespace nginx-gateway \
--set nginx.service.type=NodePort \
--set-json 'nginx.service.nodePorts=[{"port":31437,"listenerPort":80}]'

# step 3
kubectl -n nginx-gateway wait --timeout=5m deployment/ngf-nginx-gateway-fabric --for=condition=Available
