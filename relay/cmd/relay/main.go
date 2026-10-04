package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/cheapbuddy/relay/internal/app"
	"github.com/cheapbuddy/relay/internal/cache"
	"github.com/cheapbuddy/relay/internal/config"
	"github.com/cheapbuddy/relay/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		logger.Error("relay_configuration_failed", "error", err.Error())
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var durable *store.Store
	if cfg.MediaEnabled {
		durable, err = store.Open(ctx, cfg.DatabaseURL)
		if err != nil {
			logger.Error("relay_database_connect_failed", "error", err.Error())
			os.Exit(1)
		}
		defer durable.Close()
		if err := durable.Migrate(ctx); err != nil {
			logger.Error("relay_migration_failed", "error", err.Error())
			os.Exit(1)
		}
	}
	cached, err := cache.Open(cfg.RedisURL)
	if err != nil {
		logger.Error("relay_redis_configuration_failed", "error", err.Error())
		os.Exit(1)
	}
	defer cached.Close()

	relay := app.New(cfg, durable, cached, logger)
	relay.StartReconciler(ctx)
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           relay.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       cfg.StreamIdleTimeout,
	}
	go func() {
		logger.Info("relay_started", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("relay_server_failed", "error", err.Error())
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("relay_shutdown_failed", "error", err.Error())
	}
	relay.Wait()
}
