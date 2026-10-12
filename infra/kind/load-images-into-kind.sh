docker build -t local/todo-api:1.0.0 ./src/api
docker build -t local/todo-ui:1.0.0 ./src/ui
kind load docker-image local/todo-api:1.0.0 local/todo-ui:1.0.0 --name todo