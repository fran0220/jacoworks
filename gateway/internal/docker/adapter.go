package docker

import "time"

// BackendAdapter wraps Client to satisfy agent.ContainerBackend interface.
type BackendAdapter struct {
	client *Client
}

func NewBackendAdapter(c *Client) *BackendAdapter {
	return &BackendAdapter{client: c}
}

func (a *BackendAdapter) Start(name string) error {
	return a.client.Start(name)
}

func (a *BackendAdapter) Unfreeze(name string) error {
	return a.client.Unfreeze(name)
}

func (a *BackendAdapter) Status(name string) (string, error) {
	info, err := a.client.Status(name)
	if err != nil {
		return "", err
	}
	return info.Status, nil
}

func (a *BackendAdapter) WaitForHealth(name, ip string) error {
	return a.client.WaitForHealth(ip, 30*time.Second)
}
