package openclaw

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/rs/zerolog/log"
)

var ErrProfileNotFound = errors.New("profile not found")

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
	Type        string `json:"type"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	Icon        string `json:"icon,omitempty"`
	SessionKey  string `json:"sessionKey"`
}

// ProfileDetail is the full profile with file contents, used by GET/POST/PUT APIs.
type ProfileDetail struct {
	Type        string            `json:"type"`
	Name        string            `json:"name"`
	DisplayName string            `json:"displayName"`
	Description string            `json:"description"`
	Icon        string            `json:"icon,omitempty"`
	Model       string            `json:"model"`
	Skills      []string          `json:"skills,omitempty"`
	Workspace   string            `json:"workspace,omitempty"`
	Files       map[string]string `json:"files,omitempty"`
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

	return loadProfileInDir(profilesDir, name)
}

// loadProfileInDir loads a profile manifest from a given profiles directory.
func loadProfileInDir(profilesDir, name string) (*AgentProfile, string, error) {
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

// ── Shared internal helpers ──────────────────────────────────

// listProfilesInDir scans a profiles directory and returns summaries.
func listProfilesInDir(dir string) []ProfileSummary {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	results := make([]ProfileSummary, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		profile, _, err := loadProfileInDir(dir, entry.Name())
		if err != nil {
			log.Warn().Err(err).Str("profile", entry.Name()).Msg("skip invalid profile")
			continue
		}

		results = append(results, ProfileSummary{
			Type:        "agent",
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

// getProfileDetailInDir loads a profile's manifest and all text files from a given dir.
func getProfileDetailInDir(dir, name string) (*ProfileDetail, error) {
	if err := validateProfileName(name); err != nil {
		return nil, err
	}

	profileDir := filepath.Join(dir, name)
	manifestPath := filepath.Join(profileDir, "profile.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, ErrProfileNotFound
		}
		return nil, fmt.Errorf("read profile %s: %w", name, err)
	}

	var profile AgentProfile
	if err := json.Unmarshal(data, &profile); err != nil {
		return nil, fmt.Errorf("decode profile %s: %w", name, err)
	}
	if profile.Name == "" {
		profile.Name = name
	}

	detail := &ProfileDetail{
		Type:        "agent",
		Name:        profile.Name,
		DisplayName: profile.DisplayName,
		Description: profile.Description,
		Icon:        profile.Icon,
		Model:       profile.Model,
		Skills:      profile.Skills,
		Workspace:   profile.Workspace,
		Files:       make(map[string]string),
	}

	err = filepath.WalkDir(profileDir, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}

		rel, err := filepath.Rel(profileDir, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)

		if rel == "profile.json" {
			return nil
		}

		content, err := os.ReadFile(p)
		if err != nil {
			log.Warn().Err(err).Str("profile", name).Str("file", rel).Msg("skip unreadable file")
			return nil
		}
		detail.Files[rel] = string(content)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk profile %s: %w", name, err)
	}

	log.Debug().Str("profile", name).Int("files", len(detail.Files)).Msg("loaded profile detail")
	return detail, nil
}

// saveProfileInDir writes a profile manifest and its files to the given dir.
func saveProfileInDir(dir string, detail *ProfileDetail) error {
	if err := validateProfileName(detail.Name); err != nil {
		return err
	}

	profileDir := filepath.Join(dir, detail.Name)
	if err := os.MkdirAll(profileDir, 0o755); err != nil {
		return fmt.Errorf("create profile dir %s: %w", detail.Name, err)
	}

	manifest := AgentProfile{
		Name:        detail.Name,
		DisplayName: detail.DisplayName,
		Description: detail.Description,
		Icon:        detail.Icon,
		Model:       detail.Model,
		Skills:      detail.Skills,
		Workspace:   detail.Workspace,
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal profile %s: %w", detail.Name, err)
	}
	if err := os.WriteFile(filepath.Join(profileDir, "profile.json"), data, 0o644); err != nil {
		return fmt.Errorf("write profile.json for %s: %w", detail.Name, err)
	}

	for key, content := range detail.Files {
		key = filepath.ToSlash(key)
		if key == "profile.json" {
			continue
		}
		if strings.Contains(key, "..") || filepath.IsAbs(key) {
			return fmt.Errorf("invalid file path in profile %s: %q", detail.Name, key)
		}

		target := filepath.Join(profileDir, filepath.FromSlash(key))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("create dir for %s/%s: %w", detail.Name, key, err)
		}
		if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
			return fmt.Errorf("write file %s/%s: %w", detail.Name, key, err)
		}
	}

	log.Info().Str("profile", detail.Name).Int("files", len(detail.Files)).Msg("saved profile")
	return nil
}

// deleteProfileInDir removes an entire profile directory from the given dir.
func deleteProfileInDir(dir, name string) error {
	if err := validateProfileName(name); err != nil {
		return err
	}

	profileDir := filepath.Join(dir, name)
	if _, err := os.Stat(profileDir); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrProfileNotFound
		}
		return fmt.Errorf("stat profile %s: %w", name, err)
	}

	if err := os.RemoveAll(profileDir); err != nil {
		return fmt.Errorf("delete profile %s: %w", name, err)
	}

	log.Info().Str("profile", name).Msg("deleted profile")
	return nil
}

// buildProfileAgentsFromDir converts all profiles in a directory into openclaw agents.
func (c *Client) buildProfileAgentsFromDir(dir string) []openclawAgent {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	agents := make([]openclawAgent, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		profile, _, err := loadProfileInDir(dir, entry.Name())
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

// deployProfilesFromDir copies profile files from a host directory into a running container.
func (c *Client) deployProfilesFromDir(containerName, profilesDir string) (int, error) {
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

		profile, profileDir, err := loadProfileInDir(profilesDir, entry.Name())
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

		dirEntries, err := os.ReadDir(profileDir)
		if err != nil {
			continue
		}
		for _, f := range dirEntries {
			if f.IsDir() {
				if profileSkipDirs[f.Name()] {
					continue
				}
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
			sourcePath := filepath.Join(profileDir, f.Name())
			targetPath := path.Join(workspace, f.Name())
			if err := c.copyTemplateFile(containerName, sourcePath, targetPath); err != nil {
				log.Warn().Err(err).Str("profile", profile.Name).Str("file", f.Name()).Msg("copy profile workspace file failed")
				continue
			}
			filesCopied++
		}

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

// ── Profile listing (system) ─────────────────────────────────

// ListProfiles scans openclaw/profiles and returns available profiles.
func (c *Client) ListProfiles() []ProfileSummary {
	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return nil
	}
	return listProfilesInDir(profilesDir)
}

// ── Profile → OpenClaw agents (system) ───────────────────────

// buildProfileAgents converts all available system profiles into openclaw agent entries.
func (c *Client) buildProfileAgents() []openclawAgent {
	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return nil
	}
	return c.buildProfileAgentsFromDir(profilesDir)
}

// ── Profile deployment (system) ──────────────────────────────

// DeployProfiles copies profile workspace files and skills into a running container.
// Workspace files (SOUL.md, IDENTITY.md, USER.md, etc.) → agent's workspace directory.
// Skills → agent's agentDir/skills/.
// Returns the number of files copied.
func (c *Client) DeployProfiles(containerName string) (int, error) {
	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return 0, nil
	}
	return c.deployProfilesFromDir(containerName, profilesDir)
}

// ── Profile CRUD (system / package-level) ────────────────────

func validateProfileName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || name != filepath.Base(name) || strings.Contains(name, "..") {
		return fmt.Errorf("invalid profile name: %q", name)
	}
	return nil
}

// GetProfileDetail loads a profile's manifest and all text files in its directory.
func GetProfileDetail(name string) (*ProfileDetail, error) {
	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return nil, fmt.Errorf("resolve profiles dir: %w", err)
	}
	return getProfileDetailInDir(profilesDir, name)
}

// SaveProfile writes a profile manifest and its files to disk.
func SaveProfile(detail *ProfileDetail) error {
	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return fmt.Errorf("resolve profiles dir: %w", err)
	}
	return saveProfileInDir(profilesDir, detail)
}

// DeleteProfile removes an entire profile directory.
func DeleteProfile(name string) error {
	profilesDir, err := resolveProfilesDir()
	if err != nil {
		return fmt.Errorf("resolve profiles dir: %w", err)
	}
	return deleteProfileInDir(profilesDir, name)
}

// ── User-scoped profiles ─────────────────────────────────────

// userProfilesDir returns the per-user profiles directory and ensures it exists.
func (c *Client) userProfilesDir(userID string) (string, error) {
	dir := filepath.Join(c.dataRoot, userID, "profiles")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create user profiles dir: %w", err)
	}
	return dir, nil
}

// UserListProfiles returns profiles for a specific user (from their personal directory).
func (c *Client) UserListProfiles(userID string) []ProfileSummary {
	dir, err := c.userProfilesDir(userID)
	if err != nil {
		return nil
	}
	return listProfilesInDir(dir)
}

// UserGetProfileDetail loads a user's profile detail.
func (c *Client) UserGetProfileDetail(userID, name string) (*ProfileDetail, error) {
	dir, err := c.userProfilesDir(userID)
	if err != nil {
		return nil, err
	}
	return getProfileDetailInDir(dir, name)
}

// UserSaveProfile saves a profile to the user's personal directory.
func (c *Client) UserSaveProfile(userID string, detail *ProfileDetail) error {
	dir, err := c.userProfilesDir(userID)
	if err != nil {
		return err
	}
	return saveProfileInDir(dir, detail)
}

// UserDeleteProfile deletes a profile from the user's personal directory.
func (c *Client) UserDeleteProfile(userID, name string) error {
	dir, err := c.userProfilesDir(userID)
	if err != nil {
		return err
	}
	return deleteProfileInDir(dir, name)
}

// ListProfilesMerged returns system profiles merged with user-specific profiles.
// User profiles override system profiles with the same name.
func (c *Client) ListProfilesMerged(userID string) []ProfileSummary {
	systemProfiles := c.ListProfiles()
	userProfiles := c.UserListProfiles(userID)

	seen := make(map[string]ProfileSummary)
	for _, p := range systemProfiles {
		seen[p.Name] = p
	}
	for _, p := range userProfiles {
		seen[p.Name] = p
	}

	results := make([]ProfileSummary, 0, len(seen))
	for _, p := range seen {
		results = append(results, p)
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})
	return results
}

// DeployUserProfiles copies user-specific profile files into a running container.
func (c *Client) DeployUserProfiles(containerName, userID string) (int, error) {
	dir, err := c.userProfilesDir(userID)
	if err != nil {
		return 0, nil
	}
	return c.deployProfilesFromDir(containerName, dir)
}

// BuildProfileAgentsMerged returns openclaw agents from both system and user profiles.
func (c *Client) BuildProfileAgentsMerged(userID string) []openclawAgent {
	systemAgents := c.buildProfileAgents()

	dir, err := c.userProfilesDir(userID)
	if err != nil {
		return systemAgents
	}

	userAgents := c.buildProfileAgentsFromDir(dir)

	seen := make(map[string]openclawAgent)
	for _, a := range systemAgents {
		seen[a.ID] = a
	}
	for _, a := range userAgents {
		seen[a.ID] = a
	}

	result := make([]openclawAgent, 0, len(seen))
	for _, a := range seen {
		result = append(result, a)
	}
	return result
}
