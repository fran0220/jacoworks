package store

import (
	"context"
	"fmt"
	"time"
)

type ContainerInfo struct {
	UserID         string
	ContainerName  string
	ContainerIP    string
	ContainerToken string
}

type Container struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	ContainerName  string    `json:"container_name"`
	ContainerIP    string    `json:"container_ip"`
	ContainerToken string    `json:"-"`
	Status         string    `json:"status"`
	CPULimit       int       `json:"cpu_limit"`
	MemoryMB       int       `json:"memory_mb"`
	DiskMB         int       `json:"disk_mb"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (s *Store) GetContainerInfo(ctx context.Context, userID string) (*ContainerInfo, error) {
	info := &ContainerInfo{}
	err := s.pool.QueryRow(ctx,
		`SELECT user_id, container_name, COALESCE(host(container_ip), ''), container_token
		 FROM containers WHERE user_id = $1`,
		userID,
	).Scan(&info.UserID, &info.ContainerName, &info.ContainerIP, &info.ContainerToken)
	if err != nil {
		return nil, fmt.Errorf("get container info: %w", err)
	}
	return info, nil
}

func (s *Store) CreateContainer(ctx context.Context, userID, containerName, containerToken string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO containers (user_id, container_name, container_token, status)
		 VALUES ($1, $2, $3, 'creating')
		 ON CONFLICT (user_id) DO UPDATE SET container_name = $2, container_token = $3`,
		userID, containerName, containerToken,
	)
	return err
}

func (s *Store) UpdateContainerIP(ctx context.Context, userID, ip string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE containers SET container_ip = $1::inet, status = 'running' WHERE user_id = $2`,
		ip, userID,
	)
	return err
}

func (s *Store) UpdateContainer(ctx context.Context, userID, name, ip, token string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE containers SET container_name = $1, container_ip = $2::inet, container_token = $3, status = 'running'
		 WHERE user_id = $4`,
		name, ip, token, userID,
	)
	return err
}
