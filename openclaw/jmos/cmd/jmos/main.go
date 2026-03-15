package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/config"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/handler"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	log := zerolog.New(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}).
		With().Timestamp().Caller().Logger()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatal().Err(err).Str("path", *configPath).Msg("failed to load config")
	}
	log.Info().Str("project", cfg.Project.Name).Msg("config loaded")

	db, err := store.Open(cfg.Database.Path)
	if err != nil {
		log.Fatal().Err(err).Str("path", cfg.Database.Path).Msg("failed to open database")
	}
	defer db.Close()
	log.Info().Str("path", cfg.Database.Path).Msg("database ready")

	// Create service instances
	eventSvc := service.NewEventService(db)
	agentSvc := service.NewAgentService(db)
	taskSvc := service.NewTaskService(db)
	rewardSvc := service.NewRewardService(db)
	subTaskSvc := service.NewSubTaskService(db, eventSvc)
	reviewSvc := service.NewReviewService(db, subTaskSvc, rewardSvc, eventSvc)
	ruleSvc := service.NewRuleService(db, cfg)
	patrolSvc := service.NewPatrolService(db, eventSvc)
	spaceSvc := service.NewSpaceService(db)

	router := handler.NewRouter(
		cfg, db, log,
		agentSvc, taskSvc, subTaskSvc, reviewSvc, rewardSvc,
		eventSvc, ruleSvc, patrolSvc, spaceSvc,
	)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Info().Str("addr", addr).Msg("starting JMOS server")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Info().Str("signal", sig.String()).Msg("shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("shutdown error")
	}
	log.Info().Msg("server stopped")
}
