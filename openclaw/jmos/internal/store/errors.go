package store

import "fmt"

type NotFoundError struct {
	Entity string
	ID     string
}

func (e *NotFoundError) Error() string {
	return fmt.Sprintf("%s %q not found", e.Entity, e.ID)
}

type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string {
	return e.Message
}
