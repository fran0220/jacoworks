package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gorilla/websocket"

	"github.com/fran0220/jacoworks/gateway/internal/store"
)

// VMAgentDialer implements UpstreamDialer for vm-agent containers.
type VMAgentDialer struct {
	store            *store.Store
	backend          ContainerBackend
	freezer          Freezer
	agentPort        int
	dockerHostIP     string
	token            string
	containerEnvVars  map[string]string
	onContainerReady  func(userID, containerName string)
	onReprovisioned   func(userID, containerName string) // called when container is rebuilt from not_found
}

func NewVMAgentDialer(s *store.Store, backend ContainerBackend, freezer Freezer, agentPort int, dockerHostIP, token string) *VMAgentDialer {
	return &VMAgentDialer{
		store:        s,
		backend:      backend,
		freezer:      freezer,
		agentPort:    agentPort,
		dockerHostIP: dockerHostIP,
		token:        token,
	}
}

func (d *VMAgentDialer) SetContainerEnvVars(envVars map[string]string) {
	d.containerEnvVars = envVars
}

func (d *VMAgentDialer) SetOnContainerReady(fn func(userID, containerName string)) {
	d.onContainerReady = fn
}

func (d *VMAgentDialer) SetOnReprovisioned(fn func(userID, containerName string)) {
	d.onReprovisioned = fn
}

func (d *VMAgentDialer) ContainerType() string {
	return store.ContainerTypeVMAgent
}

func (d *VMAgentDialer) EnsureRunning(ctx context.Context, info *store.ContainerInfo, userID string) error {
	if d.backend == nil {
		return nil
	}

	status, err := d.backend.Status(info.ContainerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	return d.handleContainerStatus(ctx, status, info, userID)
}

func (d *VMAgentDialer) handleContainerStatus(ctx context.Context, status string, info *store.ContainerInfo, userID string) error {
	switch normalizeStatus(status) {
	case "running":
		if err := d.backend.WaitForHealth(info.ContainerName, info.ContainerIP); err == nil {
			return nil
		}
		return fmt.Errorf("container running but not healthy")
	case "paused":
		if err := d.backend.Unfreeze(info.ContainerName); err != nil {
			return err
		}
		if err := d.store.UpdateContainerStatusByName(ctx, info.ContainerName, "running"); err != nil {
			return fmt.Errorf("update container status after unpause: %w", err)
		}
		if d.onContainerReady != nil {
			go d.onContainerReady(userID, info.ContainerName)
		}
		return d.backend.WaitForHealth(info.ContainerName, info.ContainerIP)
	case "stopped", "exited":
		if err := d.backend.Start(info.ContainerName); err != nil {
			return err
		}
		if err := d.store.UpdateContainerStatusByName(ctx, info.ContainerName, "running"); err != nil {
			return fmt.Errorf("update container status after start: %w", err)
		}
		if d.onContainerReady != nil {
			go d.onContainerReady(userID, info.ContainerName)
		}
		return d.backend.WaitForHealth(info.ContainerName, info.ContainerIP)
	case "not_found":
		if d.containerEnvVars == nil {
			return fmt.Errorf("container destroyed and no env vars configured for reprovision")
		}
		ip, err := d.backend.Reprovision(info.ContainerName, userID, info.ContainerToken, d.containerEnvVars, info.HostPort)
		if err != nil {
			return fmt.Errorf("reprovision: %w", err)
		}
		if err := d.store.UpdateContainerIP(ctx, userID, store.ContainerTypeVMAgent, ip); err != nil {
			return fmt.Errorf("update IP after reprovision: %w", err)
		}
		if d.onContainerReady != nil {
			go d.onContainerReady(userID, info.ContainerName)
		}
		if d.onReprovisioned != nil {
			go d.onReprovisioned(userID, info.ContainerName)
		}
		return nil
	default:
		return fmt.Errorf("container in unexpected state: %s", status)
	}
}

func (d *VMAgentDialer) Dial(info *store.ContainerInfo) (*websocket.Conn, error) {
	url := d.UpstreamURL(info)
	return dialWithRetry(url, dialRetryTotal)
}

func (d *VMAgentDialer) UpstreamURL(info *store.ContainerInfo) string {
	var host string
	var port int
	if info.HostPort > 0 && d.dockerHostIP != "" {
		host = d.dockerHostIP
		port = info.HostPort
	} else {
		host = info.ContainerIP
		port = d.agentPort
	}
	url := fmt.Sprintf("ws://%s:%d", host, port)
	// Prefer per-container token; fall back to global gateway token
	token := info.ContainerToken
	if token == "" {
		token = d.token
	}
	if token != "" {
		url += "?token=" + token
	}
	return url
}

func (d *VMAgentDialer) MapUpstreamMessage(msg []byte) (string, []byte, bool) {
	eventType, ok := mapUpstreamToEvent(msg)
	return eventType, msg, ok
}

func (d *VMAgentDialer) FormatClientMessage(msgType string, payload json.RawMessage, requestID string) ([]byte, error) {
	if msgType == "" {
		return nil, fmt.Errorf("message type is required")
	}
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}

	// vm-agent format: merge payload with id and type
	var msg map[string]interface{}
	if err := json.Unmarshal(payload, &msg); err != nil {
		msg = make(map[string]interface{})
	}
	msg["id"] = requestID
	if msg["type"] == nil {
		msg["type"] = msgType
	}

	return json.Marshal(msg)
}

func (d *VMAgentDialer) GetFreezer() Freezer {
	return d.freezer
}

func normalizeStatus(status string) string {
	return strings.ToLower(strings.TrimSpace(status))
}
