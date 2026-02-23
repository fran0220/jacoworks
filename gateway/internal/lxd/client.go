package lxd

import "errors"

var ErrNotImplemented = errors.New("lxd: not implemented (stub)")

type ContainerStatus struct {
	Name   string
	Status string // Running, Stopped, Frozen
	IP     string
}

type Client interface {
	Clone(templateName, newName string) error
	Start(name string) error
	Stop(name string) error
	Freeze(name string) error
	Unfreeze(name string) error
	Destroy(name string) error
	Status(name string) (*ContainerStatus, error)
	GetIP(name string) (string, error)
	List() ([]ContainerStatus, error)
}

// StubClient is a placeholder implementation for Phase 3.
// Will be replaced with HTTP calls to LXD REST API.
type StubClient struct{}

func NewStubClient() *StubClient {
	return &StubClient{}
}

func (s *StubClient) Clone(templateName, newName string) error {
	return ErrNotImplemented
}

func (s *StubClient) Start(name string) error {
	return ErrNotImplemented
}

func (s *StubClient) Stop(name string) error {
	return ErrNotImplemented
}

func (s *StubClient) Freeze(name string) error {
	return ErrNotImplemented
}

func (s *StubClient) Unfreeze(name string) error {
	return ErrNotImplemented
}

func (s *StubClient) Destroy(name string) error {
	return ErrNotImplemented
}

func (s *StubClient) Status(name string) (*ContainerStatus, error) {
	return nil, ErrNotImplemented
}

func (s *StubClient) GetIP(name string) (string, error) {
	return "", ErrNotImplemented
}

func (s *StubClient) List() ([]ContainerStatus, error) {
	return nil, ErrNotImplemented
}
