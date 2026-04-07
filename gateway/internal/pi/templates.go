package pi

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type TeamTemplate struct {
	ID                 string               `json:"id"`
	Label              string               `json:"label"`
	Description        string               `json:"description"`
	Icon               string               `json:"icon,omitempty"`
	Version            string               `json:"version,omitempty"`
	WorkspaceKeyPrefix string               `json:"workspaceKeyPrefix,omitempty"`
	LeaderSystemPrompt string               `json:"leaderSystemPrompt,omitempty"`
	Members            []TeamTemplateMember `json:"members,omitempty"`
	BootstrapCommands  []string             `json:"bootstrapCommands,omitempty"`
	Theme              map[string]any       `json:"theme,omitempty"`
}

type TeamTemplateMember struct {
	Name         string `json:"name"`
	Role         string `json:"role,omitempty"`
	SpritePackId string `json:"spritePackId,omitempty"`
	Mode         string `json:"mode,omitempty"`
	Workspace    string `json:"workspace,omitempty"`
	Model        string `json:"model,omitempty"`
	Kickoff      string `json:"kickoff,omitempty"`
}

func (t TeamTemplate) DisplayLabel() string {
	if label := strings.TrimSpace(t.Label); label != "" {
		return label
	}
	return strings.TrimSpace(t.ID)
}

func (t TeamTemplate) SessionKeyPrefix() string {
	if prefix := strings.TrimSpace(t.WorkspaceKeyPrefix); prefix != "" {
		return prefix
	}
	if id := strings.TrimSpace(t.ID); id != "" {
		return fmt.Sprintf("team:%s", id)
	}
	return "team"
}

func ListTeamTemplates() ([]TeamTemplate, error) {
	root, err := resolvePiConfigSourcePath("team-templates")
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []TeamTemplate{}, nil
		}
		return nil, err
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []TeamTemplate{}, nil
		}
		return nil, fmt.Errorf("read team templates dir: %w", err)
	}

	templates := make([]TeamTemplate, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		template, err := loadTeamTemplateFile(filepath.Join(root, entry.Name()))
		if err != nil {
			return nil, err
		}
		templates = append(templates, template)
	}

	// entries from ReadDir are already sorted by filename (01-, 02-, etc.)
	return templates, nil
}

func LoadTeamTemplate(id string) (*TeamTemplate, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("template id is required")
	}

	templates, err := ListTeamTemplates()
	if err != nil {
		return nil, err
	}
	for _, template := range templates {
		if template.ID == id {
			copy := template
			return &copy, nil
		}
	}
	return nil, os.ErrNotExist
}

func loadTeamTemplateFile(path string) (TeamTemplate, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return TeamTemplate{}, fmt.Errorf("read team template %s: %w", filepath.Base(path), err)
	}

	var template TeamTemplate
	if err := json.Unmarshal(content, &template); err != nil {
		return TeamTemplate{}, fmt.Errorf("parse team template %s: %w", filepath.Base(path), err)
	}

	template.ID = strings.TrimSpace(template.ID)
	if template.ID == "" {
		return TeamTemplate{}, fmt.Errorf("parse team template %s: missing id", filepath.Base(path))
	}
	template.Label = strings.TrimSpace(template.Label)
	template.Description = strings.TrimSpace(template.Description)
	template.Icon = strings.TrimSpace(template.Icon)
	template.Version = strings.TrimSpace(template.Version)
	if template.Version == "" {
		template.Version = "1.0.0"
	}
	template.WorkspaceKeyPrefix = strings.TrimSpace(template.WorkspaceKeyPrefix)
	template.LeaderSystemPrompt = strings.TrimSpace(template.LeaderSystemPrompt)

	members := make([]TeamTemplateMember, 0, len(template.Members))
	for _, member := range template.Members {
		member.Name = strings.TrimSpace(member.Name)
		if member.Name == "" {
			continue
		}
		member.Role = strings.TrimSpace(member.Role)
		member.SpritePackId = strings.TrimSpace(member.SpritePackId)
		member.Mode = strings.TrimSpace(member.Mode)
		member.Workspace = strings.TrimSpace(member.Workspace)
		member.Model = strings.TrimSpace(member.Model)
		member.Kickoff = strings.TrimSpace(member.Kickoff)
		members = append(members, member)
	}
	template.Members = members

	commands := make([]string, 0, len(template.BootstrapCommands))
	for _, command := range template.BootstrapCommands {
		command = strings.TrimSpace(command)
		if command != "" {
			commands = append(commands, command)
		}
	}
	template.BootstrapCommands = commands

	return template, nil
}
