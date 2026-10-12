FROM mcr.microsoft.com/dotnet/sdk:10.0 as build
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . .

RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
WORKDIR /app
COPY --from=build /app .

EXPOSE 8080
ENTRYPOINT ["dotnet", "Todo.Api.dll"]
