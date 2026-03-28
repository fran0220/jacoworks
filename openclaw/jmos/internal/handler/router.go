package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/config"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

func NewRouter(
	cfg *config.Config,
	db *store.DB,
	log zerolog.Logger,
	agentSvc *service.AgentService,
	taskSvc *service.TaskService,
	subTaskSvc *service.SubTaskService,
	reviewSvc *service.ReviewService,
	rewardSvc *service.RewardService,
	eventSvc *service.EventService,
	ruleSvc *service.RuleService,
	patrolSvc *service.PatrolService,
	spaceSvc *service.SpaceService,
) http.Handler {
	r := chi.NewRouter()

	r.Use(RequestID)
	r.Use(CORS)
	r.Use(PanicRecovery(log))
	r.Use(RequestLogger(log))

	agentAuth := AgentAuth(db.Conn())
	adminSessions := NewAdminSessionStore()
	adminAuth := AdminAuth(adminSessions)

	// Handler instances
	healthH := NewHealthHandler(cfg)
	agentH := NewAgentHandler(agentSvc, cfg.Agent.RegistrationToken, cfg.Agent.AllowRegistration)
	taskH := NewTaskHandler(taskSvc)
	subTaskH := NewSubTaskHandler(subTaskSvc)
	reviewH := NewReviewHandler(reviewSvc)
	scoreH := NewScoreHandler(rewardSvc, db)
	ruleH := NewRuleHandler(ruleSvc)
	eventH := NewEventHandler(eventSvc)
	spaceH := NewSpaceHandler(spaceSvc)
	statsH := NewStatsHandler(db)
	logH := NewLogHandler(db)
	feedH := NewFeedHandler(db, cfg)
	patrolH := NewPatrolHandler(patrolSvc)
	adminH := NewAdminHandler(cfg, db, agentSvc, taskSvc, subTaskSvc, rewardSvc, adminSessions)

	apiRoutes := func(r chi.Router) {
		// Health
		r.Get("/health", healthH.Health)

		// Config
		r.Get("/config/notification", healthH.NotificationConfig)

		// Agent routes
		r.Route("/agents", func(r chi.Router) {
			r.Post("/register", agentH.Register)
			r.With(adminAuth).Post("/", agentH.Create)
			r.With(agentAuth).Get("/", agentH.List)
			r.With(agentAuth).Get("/{id}", agentH.Get)
			r.With(adminAuth).Put("/{id}/status", agentH.UpdateStatus)
			r.With(agentAuth).Post("/{id}/pulse", agentH.Pulse)
		})

		// Task routes
		r.Route("/tasks", func(r chi.Router) {
			r.Use(agentAuth)
			r.With(RequireRole("planner")).Post("/", taskH.Create)
			r.Get("/", taskH.List)
			r.Get("/{id}", taskH.Get)
			r.With(RequireRole("planner")).Put("/{id}", taskH.Update)
			r.With(RequireRole("planner")).Put("/{id}/status", taskH.UpdateStatus)
			r.Post("/{id}/cancel", taskH.Cancel)
			r.Post("/{id}/modules", taskH.CreateModule)
			r.Get("/{id}/modules", taskH.ListModules)
		})

		// SubTask routes
		r.Route("/sub-tasks", func(r chi.Router) {
			r.Use(agentAuth)
			r.With(RequireRole("planner")).Post("/", subTaskH.Create)
			r.Get("/", subTaskH.List)
			r.Get("/mine", subTaskH.Mine)
			r.Get("/available", subTaskH.Available)
			r.Get("/latest", subTaskH.Latest)
			r.Get("/{id}", subTaskH.Get)
			r.With(RequireRole("planner")).Put("/{id}", subTaskH.Update)
			r.With(RequireRole("executor")).Post("/{id}/claim", subTaskH.Claim)
			r.With(RequireRole("executor")).Post("/{id}/start", subTaskH.Start)
			r.With(RequireRole("executor")).Post("/{id}/submit", subTaskH.Submit)
			r.With(RequireRole("reviewer")).Post("/{id}/complete", subTaskH.Complete)
			r.With(RequireRole("reviewer")).Post("/{id}/rework", subTaskH.Rework)
			r.With(RequireRole("patrol")).Post("/{id}/block", subTaskH.Block)
			r.With(RequireRole("planner")).Post("/{id}/reassign", subTaskH.Reassign)
			r.With(RequireRole("planner")).Post("/{id}/cancel", subTaskH.Cancel)
			r.With(RequireRole("executor")).Post("/{id}/session", subTaskH.UpdateSession)
		})

		// Review routes
		r.Route("/reviews", func(r chi.Router) {
			r.Use(agentAuth)
			r.With(RequireRole("reviewer")).Post("/", reviewH.Create)
			r.Get("/", reviewH.List)
			r.Get("/{id}", reviewH.Get)
		})
		r.Route("/review-records", func(r chi.Router) {
			r.Use(agentAuth)
			r.With(RequireRole("reviewer")).Post("/", reviewH.Create)
			r.Get("/", reviewH.List)
			r.Get("/{id}", reviewH.Get)
		})

		// Score routes
		r.Route("/scores", func(r chi.Router) {
			r.Use(agentAuth)
			r.Get("/leaderboard", scoreH.Leaderboard)
			r.Get("/me", scoreH.Me)
			r.Get("/me/logs", scoreH.MeLogs)
			r.Get("/{agent_id}", scoreH.AgentScore)
			r.Get("/{agent_id}/logs", scoreH.AgentLogs)
			r.Post("/adjust", scoreH.Adjust)
		})

		// Patrol routes
		r.Route("/patrol", func(r chi.Router) {
			r.Use(agentAuth)
			r.Post("/report", patrolH.Report)
			r.Get("/active", patrolH.Active)
			r.Get("/", patrolH.List)
		})

		// Rule routes
		r.Route("/rules", func(r chi.Router) {
			r.With(agentAuth).Get("/", ruleH.GetMerged)
			r.With(adminAuth).Get("/list", ruleH.List)
			r.With(adminAuth).Get("/{id}", ruleH.Get)
			r.With(adminAuth).Post("/", ruleH.Create)
			r.With(adminAuth).Put("/{id}", ruleH.Update)
			r.With(adminAuth).Delete("/{id}", ruleH.Delete)
		})

		// Log routes (compat with Python task-cli.py)
		r.Route("/logs", func(r chi.Router) {
			r.Use(agentAuth)
			r.Post("/", logH.Create)
			r.Get("/", logH.List)
			r.Get("/mine", logH.Mine)
		})

		// Event stream (incremental polling)
		r.With(agentAuth).Get("/events", eventH.List)

		// Space routes (visualization)
		r.Route("/space", func(r chi.Router) {
			r.Get("/graph", spaceH.Graph)
			r.Get("/pulse", spaceH.Pulse)
			r.Get("/orbits", spaceH.Orbits)
		})

		// Stats routes (dashboard)
		r.Route("/stats", func(r chi.Router) {
			r.Get("/overview", statsH.Overview)
			r.Get("/timeline", statsH.Timeline)
			r.Get("/flow", statsH.Flow)
			r.Get("/distribution", statsH.Distribution)
			r.Get("/agents", statsH.Agents)
			r.Get("/agent-heatmap", statsH.AgentHeatmap)
			r.Get("/velocity", statsH.Velocity)
			r.Get("/agent-workload", statsH.AgentWorkload)
			r.Get("/interactions", statsH.Interactions)
		})

		// Feed routes (public display, compat with Python)
		r.Route("/feed", func(r chi.Router) {
			r.Get("/status", feedH.Status)
			r.Get("/logs", feedH.Logs)
			r.Get("/agents", feedH.Agents)
			r.Get("/agent-summary", feedH.AgentSummary)
		})

		// Admin routes
		r.Route("/admin", func(r chi.Router) {
			r.Post("/login", adminH.Login)
			r.Group(func(r chi.Router) {
				r.Use(adminAuth)
				r.Get("/tasks", adminH.ListTasks)
				r.Get("/tasks/{id}", adminH.GetTask)
				r.Get("/tasks/{id}/sub-tasks", adminH.TaskSubTasks)
				r.Get("/tasks/{id}/modules", adminH.TaskModules)
				r.Get("/modules/{id}", adminH.GetModule)
				r.Get("/modules/{id}/sub-tasks", adminH.ModuleSubTasks)
				r.Get("/sub-tasks", adminH.ListSubTasks)
				r.Get("/sub-tasks/{id}", adminH.GetSubTask)
				r.Get("/agents", adminH.ListAgents)
				r.Get("/agents/{id}", adminH.GetAgent)
				r.Post("/agents", adminH.CreateAgent)
				r.Put("/agents/{id}/status", adminH.UpdateAgentStatus)
				r.Post("/agents/{id}/reset-key", adminH.ResetKey)
				r.Get("/agents/{id}/score-logs", adminH.AgentScoreLogs)
				r.Get("/agents/{id}/activity-logs", adminH.AgentActivityLogs)
				r.Get("/agents/{id}/request-logs", adminH.AgentRequestLogs)
			})
		})
	}

	// Dual mount: /api/v1/* and /api/* (compat with Python task-cli.py)
	r.Route("/api/v1", apiRoutes)
	r.Route("/api", apiRoutes)

	return r
}
