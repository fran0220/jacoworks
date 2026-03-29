package openclaw

import "testing"

func TestResolveJMOSDatabasePath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		rawPath       string
		workspaceRoot string
		want          string
	}{
		{
			name:          "default when empty",
			rawPath:       "",
			workspaceRoot: "",
			want:          defaultJMOSDBPath,
		},
		{
			name:          "absolute sqlite uri",
			rawPath:       "sqlite:///data/teams/jamoss/tasks.db",
			workspaceRoot: "/data/teams/jamoss",
			want:          "/data/teams/jamoss/tasks.db",
		},
		{
			name:          "relative path joins workspace",
			rawPath:       "./data/tasks.db",
			workspaceRoot: "/data/workspace/jamoss",
			want:          "/data/workspace/jamoss/data/tasks.db",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := resolveJMOSDatabasePath(tt.rawPath, tt.workspaceRoot); got != tt.want {
				t.Fatalf("resolveJMOSDatabasePath(%q, %q) = %q, want %q", tt.rawPath, tt.workspaceRoot, got, tt.want)
			}
		})
	}
}

func TestApplyJMOSTemplateOverrides(t *testing.T) {
	t.Parallel()

	cfg := defaultJMOSConfig()
	workspaceRoot := resolveJMOSWorkspaceRoot(cfg.Workspace.Root)
	databasePath := resolveJMOSDatabasePath(cfg.Database.Path, workspaceRoot)

	manifest := &openclawTemplateManifest{
		Name:        "jamoss",
		DisplayName: "JaMOSS 多智能体协作团队",
		Workspace: openclawTemplateWorkspaceSpec{
			SharedRoot: "/data/teams/{team_id}",
		},
		Middleware: openclawTemplateMiddleware{
			Type:     "jamoss",
			Port:     6565,
			Database: "sqlite:///data/teams/{team_id}/tasks.db",
		},
	}

	applyJMOSTemplateOverrides(&cfg, manifest, &workspaceRoot, &databasePath)

	if cfg.Project.Name != "JaMOSS 多智能体协作团队" {
		t.Fatalf("project name = %q", cfg.Project.Name)
	}
	if workspaceRoot != "/data/teams/jamoss" {
		t.Fatalf("workspace root = %q", workspaceRoot)
	}
	if databasePath != "/data/teams/jamoss/tasks.db" {
		t.Fatalf("database path = %q", databasePath)
	}
}
