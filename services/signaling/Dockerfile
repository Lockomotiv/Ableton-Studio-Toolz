# Baut den Signalisierungsdienst als kleines Container-Image.
#   docker build -f services/signaling/Dockerfile -t lom-signaling .
FROM rust:1-slim AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p lom-signaling

FROM debian:stable-slim
RUN useradd --system --no-create-home lom
COPY --from=build /src/target/release/lom-signaling /usr/local/bin/lom-signaling
USER lom
EXPOSE 8787
ENTRYPOINT ["lom-signaling", "--bind", "0.0.0.0:8787"]
