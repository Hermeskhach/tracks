FROM node:24-alpine AS frontend
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src
COPY server/Tracks.Api.csproj server/
RUN dotnet restore server
COPY server/ server/
RUN dotnet publish server -c Release -o /app/publish --no-restore
COPY --from=frontend /web/dist/web/browser/ /app/publish/wwwroot/

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=backend /app/publish .
RUN mkdir -p /home/app/.aspnet/DataProtection-Keys && chown -R app:app /home/app/.aspnet
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Tracks.Api.dll"]
