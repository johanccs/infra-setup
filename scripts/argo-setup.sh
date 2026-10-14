kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
-f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

kubectl -n argocd rollout status deployment/argocd-server

# get argocd password and perform port forwarding
kubectl -n argocd get secret argo-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
StzQL6xLBXVXLiYa

kubectl -n argocd port-forward svc/argocd-server 8443:443