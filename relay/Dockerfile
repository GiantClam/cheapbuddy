FROM golang:1.24-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/relay ./cmd/relay

FROM alpine:3.22

RUN addgroup -S relay && adduser -S relay -G relay && apk add --no-cache ca-certificates
COPY --from=build /out/relay /usr/local/bin/relay

EXPOSE 8080
USER relay
ENTRYPOINT ["/usr/local/bin/relay"]
