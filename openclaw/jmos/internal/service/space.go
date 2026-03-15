package service

import (
	"context"
	"time"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type SpaceService struct {
	db *store.DB
}

func NewSpaceService(db *store.DB) *SpaceService {
	return &SpaceService{db: db}
}

// --- Graph types ---

type SpaceGraph struct {
	Nodes       []GraphNode `json:"nodes"`
	Edges       []GraphEdge `json:"edges"`
	LatestSeq   int64       `json:"latest_seq"`
	GeneratedAt time.Time   `json:"generated_at"`
}

type GraphNode struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	Label      string     `json:"label"`
	Role       string     `json:"role"`
	AvatarSeed string     `json:"avatar_seed"`
	State      string     `json:"state"`
	Energy     int        `json:"energy"`
	Stats      AgentStats `json:"stats"`
}

type AgentStats struct {
	Completed  int     `json:"completed"`
	AvgScore   float64 `json:"avg_score"`
	ReworkRate float64 `json:"rework_rate"`
	ActiveMins int     `json:"active_minutes"`
}

type GraphEdge struct {
	Source     string `json:"source"`
	Target     string `json:"target"`
	Type       string `json:"type"`
	Weight     int    `json:"weight"`
	LastActive string `json:"last_active"`
}

// --- Pulse types ---

type PulseResponse struct {
	Agents                  []PulseAgent `json:"agents"`
	ServerTime              time.Time    `json:"server_time"`
	OfflineThresholdSeconds int          `json:"offline_threshold_seconds"`
}

type PulseAgent struct {
	ID              string     `json:"id"`
	Status          string     `json:"status"`
	CurrentAction   string     `json:"current_action"`
	CurrentSubTaskID string    `json:"current_sub_task_id"`
	SubTaskName     string     `json:"sub_task_name,omitempty"`
	LastSeenAt      *time.Time `json:"last_seen_at"`
	TodayRequests   int        `json:"today_requests"`
	TodaySubmits    int        `json:"today_submits"`
	TodayReviews    int        `json:"today_reviews"`
}

// --- Orbit types ---

type OrbitData struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	OrbitRadius int    `json:"orbit_radius"`
	Pulse       bool   `json:"pulse"`
}

// BuildGraph constructs the force-directed graph data.
func (s *SpaceService) BuildGraph(ctx context.Context, project string) (*SpaceGraph, error) {
	agents, err := s.db.ListAgents(ctx, "", "")
	if err != nil {
		return nil, err
	}

	nodes := make([]GraphNode, 0, len(agents))
	for _, a := range agents {
		stats := s.calcAgentStats(ctx, a.ID)
		nodes = append(nodes, GraphNode{
			ID:         a.ID,
			Type:       "agent",
			Label:      a.Name,
			Role:       a.Role,
			AvatarSeed: a.AvatarSeed,
			State:      a.Status,
			Energy:     calcEnergy(a.TotalScore),
			Stats:      stats,
		})
	}

	interactions, err := s.db.AggregateInteractions(ctx, project, 7)
	if err != nil {
		return nil, err
	}

	edges := make([]GraphEdge, 0, len(interactions))
	for _, ie := range interactions {
		edges = append(edges, GraphEdge{
			Source:     ie.Source,
			Target:     ie.Target,
			Type:       ie.Type,
			Weight:     ie.Weight,
			LastActive: ie.LastActive,
		})
	}

	latestSeq, _ := s.db.LatestSeq(ctx)

	return &SpaceGraph{
		Nodes:       nodes,
		Edges:       edges,
		LatestSeq:   latestSeq,
		GeneratedAt: time.Now().UTC(),
	}, nil
}

// GetPulse returns lightweight agent status for 3s polling.
func (s *SpaceService) GetPulse(ctx context.Context) (*PulseResponse, error) {
	agents, err := s.db.ListAgents(ctx, "", "")
	if err != nil {
		return nil, err
	}

	agentIDs := make([]string, len(agents))
	for i, a := range agents {
		agentIDs[i] = a.ID
	}

	todayRequests, _ := s.db.CountTodayByAgent(ctx, agentIDs)
	todaySubmits, _ := s.db.CountTodaySubmitsByAgent(ctx, agentIDs)
	todayReviews, _ := s.db.CountTodayReviewsByAgent(ctx, agentIDs)

	pulseAgents := make([]PulseAgent, 0, len(agents))
	for _, a := range agents {
		pa := PulseAgent{
			ID:               a.ID,
			Status:           a.Status,
			CurrentAction:    a.CurrentAction,
			CurrentSubTaskID: a.CurrentSubTaskID,
			LastSeenAt:       a.LastSeenAt,
			TodayRequests:    todayRequests[a.ID],
			TodaySubmits:     todaySubmits[a.ID],
			TodayReviews:     todayReviews[a.ID],
		}

		if a.CurrentSubTaskID != "" {
			if st, err := s.db.GetSubTaskByID(ctx, a.CurrentSubTaskID); err == nil {
				pa.SubTaskName = st.Name
			}
		}

		pulseAgents = append(pulseAgents, pa)
	}

	return &PulseResponse{
		Agents:                  pulseAgents,
		ServerTime:              time.Now().UTC(),
		OfflineThresholdSeconds: 300,
	}, nil
}

// GetOrbits returns the sub-tasks orbiting around an agent.
func (s *SpaceService) GetOrbits(ctx context.Context, agentID string) ([]OrbitData, error) {
	subTasks, _, err := s.db.ListSubTasks(ctx, "", "", "", agentID, 1, 100, "created_at", "DESC")
	if err != nil {
		return nil, err
	}

	var orbits []OrbitData
	for _, st := range subTasks {
		if st.Status == "done" || st.Status == "cancelled" {
			continue
		}
		orbits = append(orbits, OrbitData{
			ID:          st.ID,
			Name:        st.Name,
			Status:      st.Status,
			Priority:    st.Priority,
			OrbitRadius: priorityToRadius(st.Priority),
			Pulse:       st.Status == "review" || st.Status == "blocked" || st.Status == "rework",
		})
	}
	return orbits, nil
}

func calcEnergy(totalScore int) int {
	energy := 50 + totalScore
	if energy < 0 {
		return 0
	}
	if energy > 100 {
		return 100
	}
	return energy
}

func priorityToRadius(priority string) int {
	switch priority {
	case "critical":
		return 1
	case "high":
		return 2
	case "medium":
		return 3
	default:
		return 4
	}
}

func (s *SpaceService) calcAgentStats(ctx context.Context, agentID string) AgentStats {
	var stats AgentStats

	s.db.Conn().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sub_task WHERE assigned_agent = ? AND status = 'done'`, agentID,
	).Scan(&stats.Completed)

	s.db.Conn().QueryRowContext(ctx,
		`SELECT COALESCE(AVG(rr.score), 0) FROM review_record rr
		 JOIN sub_task st ON rr.sub_task_id = st.id
		 WHERE st.assigned_agent = ?`, agentID,
	).Scan(&stats.AvgScore)

	var totalAssigned, reworked int
	s.db.Conn().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sub_task WHERE assigned_agent = ?`, agentID,
	).Scan(&totalAssigned)
	s.db.Conn().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sub_task WHERE assigned_agent = ? AND rework_count > 0`, agentID,
	).Scan(&reworked)
	if totalAssigned > 0 {
		stats.ReworkRate = float64(reworked) / float64(totalAssigned)
	}

	s.db.Conn().QueryRowContext(ctx,
		`SELECT COALESCE(SUM(actual_minutes), 0) FROM sub_task WHERE assigned_agent = ? AND status = 'done'`, agentID,
	).Scan(&stats.ActiveMins)

	return stats
}
