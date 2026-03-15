package openclaw

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/rs/zerolog/log"
)

// ── Profile types ────────────────────────────────────────────

// AgentProfile defines a single-agent profile (e.g., "main", "xiaohongshu").
// The profile directory contains OpenClaw-native workspace files:
//
//	SOUL.md      — persona, tone, values
//	IDENTITY.md  — agent name, vibe, emoji
//	USER.md      — user context
//	AGENTS.md    — operating instructions
//	TOOLS.md     — tool guidance
//	HEARTBEAT.md — cron checklist (optional)
//	MEMORY.md    — curated memory (optional)
//	skills/      — OpenClaw AgentSkill packages
type AgentProfile struct {
	Name        string   `json:"name"`
	DisplayName string   `json:"displayName"`
	Description string   `json:"description"`
	Icon        string   `json:"icon,omitempty"`
	Model       string   `json:"model"`
	Skills      []string `json:"skills,omitempty"`
	Workspace   string   `json:"workspace,omitempty"`
}

// ProfileSummary is the lightweight profile info returned by the API.
type ProfileSummary struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	Icon        string `json:"icon,omitempty"`
	SessionKey  string `json:"sessionKey"`
}

// skipFiles are files in the profile directory that should NOT be copied to workspace.
var profileSkipFiles = map[string]bool{
	"profile.json": true,
}

// skipDirs are directories that need special handling (not workspace files).
var profileSkipDirs = map[string]bool{
	"skills": true,
}

// ── Profile resolution ───────────────────────────────────────

func resolveProfilesDir() (string, error) {
	candidates := make([]string, 0, 8)
	for _, key := range []string{"GATEWAY_OPENCLAW_PROFILES_DIR", "OPENCLAW_PROFILES_DIR"} {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			candidates = append(candidates, v)
		}
	}

	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "openclaw", "profiles"),
			filepath.Join(wd, "..", "openclaw", "profiles"),
		)
	}

	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates,
			filepath.Join(exeDir, "openclaw", "profiles"),
			filepath.Join(exeDir, "..", "openclaw", "profiles"),
			filepath.Join(exeDir, "..", "..", "openclaw", "profiles"),
		)
	}

	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		abs, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		if st, err := os.Stat(abs); err == nil && st.IsDir() {
			return abs, nil
		}
	}

	return "", fmt.Errorf("profiles directory not found")
}

func (c *Client) loadProfile(name string) (*AgentProfile, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || name != filepath.Base(name) || strings.Contains(name, "..") {
		return nil, "", fmt.Errorf("invalid profile name: %q", name)
	}

	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return nil, "", err
	}

	profileDir := filepath.Join(profilesDir, name)
	manifestPath := filepath.Join(profileDir, "profile.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, "", fmt.Errorf("read profile %s: %w", name, err)
	}

	var profile AgentProfile
	if err := json.Unmarshal(data, &profile); err != nil {
		return nil, "", fmt.Errorf("decode profile %s: %w", name, err)
	}
	if profile.Name == "" {
		profile.Name = name
	}

	return &profile, profileDir, nil
}

// ── Profile listing ──────────────────────────────────────────

// ListProfiles scans openclaw/profiles and returns available profiles.
func (c *Client) ListProfiles() []ProfileSummary {
	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return nil
	}

	entries, err := os.ReadDir(profilesDir)
	if err != nil {
		return nil
	}

	results := make([]ProfileSummary, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		profile, _, err := c.loadProfile(entry.Name())
		if err != nil {
			log.Warn().Err(err).Str("profile", entry.Name()).Msg("skip invalid profile")
			continue
		}

		results = append(results, ProfileSummary{
			Name:        profile.Name,
			DisplayName: profile.DisplayName,
			Description: profile.Description,
			Icon:        profile.Icon,
			SessionKey:  fmt.Sprintf("agent:%s:main", profile.Name),
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results
}

// ── Profile → OpenClaw agents ────────────────────────────────

// buildProfileAgents converts all available profiles into openclaw agent entries.
func (c *Client) buildProfileAgents() []openclawAgent {
	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return nil
	}

	entries, err := os.ReadDir(profilesDir)
	if err != nil {
		return nil
	}

	agents := make([]openclawAgent, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		profile, _, err := c.loadProfile(entry.Name())
		if err != nil {
			continue
		}

		model := profile.Model
		if model == "" {
			model = "proxy/gpt-5.4"
		}

		workspace := profile.Workspace
		if workspace == "" {
			workspace = "/data/workspace"
		}

		agents = append(agents, openclawAgent{
			ID:        profile.Name,
			Workspace: workspace,
			AgentDir:  path.Join("/home/node/.openclaw/agents", profile.Name),
			Model:     openclawModelRef{Primary: model},
			Skills:    profile.Skills,
		})
	}

	return agents
}

// ── Profile deployment ───────────────────────────────────────

// DeployProfiles copies profile workspace files and skills into a running container.
// Workspace files (SOUL.md, IDENTITY.md, USER.md, etc.) → agent's workspace directory.
// Skills → agent's agentDir/skills/.
// Returns the number of files copied.
func (c *Client) DeployProfiles(containerName string) (int, error) {
	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return 0, nil
	}

	entries, err := os.ReadDir(profilesDir)
	if err != nil {
		return 0, nil
	}

	ctx := context.Background()
	filesCopied := 0

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		profile, profileDir, err := c.loadProfile(entry.Name())
		if err != nil {
			continue
		}

		workspace := profile.Workspace
		if workspace == "" {
			workspace = "/data/workspace"
		}

		agentDir := path.Join("/home/node/.openclaw/agents", profile.Name)
		c.rt.Exec(ctx, containerName, "mkdir", "-p", workspace)
		c.rt.Exec(ctx, containerName, "mkdir", "-p", path.Join(agentDir, "skills"))

		// Copy workspace files (*.md except profile.json, skip skills/ dir)
		dirEntries, err := os.ReadDir(profileDir)
		if err != nil {
			continue
		}
		for _, f := range dirEntries {
			if f.IsDir() {
				if profileSkipDirs[f.Name()] {
					continue
				}
				// Copy non-skip subdirectories to workspace
				n, copyErr := c.copyTemplateDir(containerName, filepath.Join(profileDir, f.Name()), path.Join(workspace, f.Name()))
				if copyErr != nil {
					log.Warn().Err(copyErr).Str("profile", profile.Name).Str("dir", f.Name()).Msg("copy profile dir failed")
				} else {
					filesCopied += n
				}
				continue
			}
			if profileSkipFiles[f.Name()] {
				continue
			}
			// Copy file to workspace (SOUL.md, IDENTITY.md, USER.md, AGENTS.md, etc.)
			sourcePath := filepath.Join(profileDir, f.Name())
			targetPath := path.Join(workspace, f.Name())
			if err := c.copyTemplateFile(containerName, sourcePath, targetPath); err != nil {
				log.Warn().Err(err).Str("profile", profile.Name).Str("file", f.Name()).Msg("copy profile workspace file failed")
				continue
			}
			filesCopied++
		}

		// Copy skills to agentDir
		for _, skill := range profile.Skills {
			sourceSkillDir := filepath.Join(profileDir, "skills", skill)
			n, err := c.copyTemplateDir(containerName, sourceSkillDir, path.Join(agentDir, "skills", skill))
			if err != nil {
				log.Warn().Err(err).Str("profile", profile.Name).Str("skill", skill).Msg("copy profile skill failed")
				continue
			}
			filesCopied += n
		}
	}

	return filesCopied, nil
}
