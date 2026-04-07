package workflow

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Stage struct {
	Name           string `json:"name"`
	AgentName      string `json:"agent_name"`
	PromptTemplate string `json:"prompt_template"`
	Next           string `json:"next"`
}

type Workflow struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	Stages    []Stage   `json:"stages"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) Create(ctx context.Context, userID, name string, stages []Stage) (*Workflow, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("workflow name is required")
	}
	if err := validateStages(stages); err != nil {
		return nil, err
	}

	stagesJSON, err := json.Marshal(stages)
	if err != nil {
		return nil, fmt.Errorf("encode workflow stages: %w", err)
	}

	w := &Workflow{}
	var stagesRaw []byte
	err = s.pool.QueryRow(ctx,
		`INSERT INTO workflows (user_id, name, stages)
		 VALUES ($1, $2, $3::jsonb)
		 RETURNING id, user_id, name, stages, enabled, created_at, updated_at`,
		userID, name, stagesJSON,
	).Scan(&w.ID, &w.UserID, &w.Name, &stagesRaw, &w.Enabled, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create workflow: %w", err)
	}

	if err := json.Unmarshal(stagesRaw, &w.Stages); err != nil {
		return nil, fmt.Errorf("decode workflow stages: %w", err)
	}
	return w, nil
}

// Get is kept for compatibility with older call sites that do not scope by user.
func (s *Store) Get(ctx context.Context, workflowID string) (*Workflow, error) {
	return s.getWithQuery(ctx,
		`SELECT id, user_id, name, stages, enabled, created_at, updated_at
		 FROM workflows WHERE id = $1`,
		workflowID,
	)
}

func (s *Store) GetByUser(ctx context.Context, userID, workflowID string) (*Workflow, error) {
	return s.getWithQuery(ctx,
		`SELECT id, user_id, name, stages, enabled, created_at, updated_at
		 FROM workflows WHERE id = $1 AND user_id = $2`,
		workflowID, userID,
	)
}

func (s *Store) getWithQuery(ctx context.Context, q string, args ...any) (*Workflow, error) {
	w := &Workflow{}
	var stagesRaw []byte
	err := s.pool.QueryRow(ctx, q, args...,
	).Scan(&w.ID, &w.UserID, &w.Name, &stagesRaw, &w.Enabled, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get workflow: %w", err)
	}
	if err := json.Unmarshal(stagesRaw, &w.Stages); err != nil {
		return nil, fmt.Errorf("decode workflow stages: %w", err)
	}
	return w, nil
}

func (s *Store) ListByUser(ctx context.Context, userID string) ([]Workflow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, name, stages, enabled, created_at, updated_at
		 FROM workflows WHERE user_id = $1 ORDER BY name ASC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list workflows: %w", err)
	}
	defer rows.Close()

	var workflows []Workflow
	for rows.Next() {
		var w Workflow
		var stagesRaw []byte
		if err := rows.Scan(&w.ID, &w.UserID, &w.Name, &stagesRaw, &w.Enabled, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workflow: %w", err)
		}
		if err := json.Unmarshal(stagesRaw, &w.Stages); err != nil {
			return nil, fmt.Errorf("decode workflow stages: %w", err)
		}
		workflows = append(workflows, w)
	}
	return workflows, nil
}

func (s *Store) Update(ctx context.Context, userID, workflowID, name string, stages []Stage, enabled bool) (*Workflow, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("workflow name is required")
	}
	if err := validateStages(stages); err != nil {
		return nil, err
	}

	stagesJSON, err := json.Marshal(stages)
	if err != nil {
		return nil, fmt.Errorf("encode workflow stages: %w", err)
	}

	tag, err := s.pool.Exec(ctx,
		`UPDATE workflows SET name = $1, stages = $2::jsonb, enabled = $3
		 WHERE id = $4 AND user_id = $5`,
		name, stagesJSON, enabled, workflowID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("update workflow: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("workflow not found")
	}

	return s.GetByUser(ctx, userID, workflowID)
}

func (s *Store) FindStage(stages []Stage, name string) *Stage {
	return FindStage(stages, name)
}

func (s *Store) FirstStage(stages []Stage) *Stage {
	return FirstStage(stages)
}

func FindStage(stages []Stage, name string) *Stage {
	for i := range stages {
		if stages[i].Name == name {
			return &stages[i]
		}
	}
	return nil
}

func FirstStage(stages []Stage) *Stage {
	if len(stages) == 0 {
		return nil
	}
	return &stages[0]
}

func validateStages(stages []Stage) error {
	index := make(map[string]struct{}, len(stages))
	for _, stage := range stages {
		name := strings.TrimSpace(stage.Name)
		if name == "" {
			return fmt.Errorf("workflow stage name is required")
		}
		if strings.TrimSpace(stage.AgentName) == "" {
			return fmt.Errorf("workflow stage %q agent_name is required", name)
		}
		if _, exists := index[name]; exists {
			return fmt.Errorf("duplicate workflow stage %q", name)
		}
		index[name] = struct{}{}
	}
	for _, stage := range stages {
		if next := strings.TrimSpace(stage.Next); next != "" {
			if _, ok := index[next]; !ok {
				return fmt.Errorf("workflow stage %q points to missing next stage %q", stage.Name, next)
			}
		}
	}
	return nil
}
